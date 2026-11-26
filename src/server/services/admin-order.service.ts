import "server-only";
import { Types } from "mongoose";
import type { z } from "zod";
import type { AdminOrder, AdminOrderStatus } from "@/types/admin";
import { connectToDatabase } from "@/server/db/connect";
import { withTransaction } from "@/server/db/transaction";
import { AppError, badRequest, conflict, notFound } from "@/server/http/errors";
import { Order } from "@/server/models/order.model";
import { Payment } from "@/server/models/payment.model";
import { StoreSettings } from "@/server/models/store-settings.model";
import type { bulkOrderStatusBody, orderListQuery, orderStatusBody, trackingBody } from "@/server/validation/admin-sales";
import { audit, type AuditActor } from "./audit.service";
import { DB_STATUS_FOR, FULFILMENT_NEXT, PAID_STATUSES, dateRange, escapeRegex, pageOf, toAdminOrder, type AdminOrderDoc, type DbOrderStatus } from "./admin-sales.shared";
import { releaseUnpaidOrder } from "./order.service";
import { reconcileOrder } from "./payment.service";
import { restockVariant, type StockActor } from "./stock-reservation.service";

/**
 * Admin orders: search, details and fulfilment. Payment is never set here — only Razorpay
 * verification and webhooks mark an order paid. Every change is a one-way, server-validated
 * status move recorded in the order's history and the audit log; orders are never deleted.
 */

const adminActor = (a: AuditActor): StockActor & { id?: string } => ({ type: "admin", id: a.adminId ?? undefined, name: a.name ?? "Admin" });

/* ---------- List ---------- */

export async function listOrders(q: z.output<typeof orderListQuery>) {
  await connectToDatabase();
  const base: Record<string, unknown> = {};
  const created = dateRange(q.from, q.to);
  if (created) base.createdAt = created;
  if (q.paymentStatus) base.paymentStatus = q.paymentStatus;
  if (q.customer) base.user = new Types.ObjectId(q.customer);
  if (q.method) base.paymentMethod = q.method;
  if (q.q) {
    const term = escapeRegex(q.q);
    const digits = q.q.replace(/\D/g, "");
    base.$or = [
      { orderNumber: { $regex: `^${escapeRegex(q.q.toUpperCase())}` } },
      { "customer.fullName": { $regex: term, $options: "i" } },
      { "customer.email": { $regex: term, $options: "i" } },
      ...(digits.length >= 3 ? [{ "customer.mobile": { $regex: escapeRegex(digits.slice(-10)) } }] : []),
    ];
  }
  const filter = q.status ? { ...base, status: DB_STATUS_FOR[q.status] } : base;
  const dir: 1 | -1 = q.dir === "asc" ? 1 : -1;
  const sort: Record<string, 1 | -1> = q.sort === "total" ? { totalPaise: dir, _id: -1 } : { createdAt: dir, _id: -1 };

  const [docs, total, byStatus, revenue] = await Promise.all([
    Order.find(filter)
      .sort(sort)
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean<AdminOrderDoc[]>(),
    Order.countDocuments(filter),
    Order.aggregate<{ _id: DbOrderStatus; n: number }>([{ $match: base }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    Order.aggregate<{ paise: number }>([
      { $match: { ...filter, paymentStatus: { $in: [...PAID_STATUSES] }, status: { $ne: "cancelled" } } },
      { $group: { _id: null, paise: { $sum: { $subtract: ["$totalPaise", { $ifNull: ["$refundedPaise", 0] }] } } } },
    ]),
  ]);
  const counts: Partial<Record<AdminOrderStatus | "all", number>> = { all: byStatus.reduce((n, s) => n + s.n, 0) };
  for (const s of byStatus) {
    const label = Object.entries(DB_STATUS_FOR).find(([, db]) => db === s._id)?.[0] as AdminOrderStatus | undefined;
    if (label) counts[label] = s.n;
  }
  return { ...pageOf(docs.map(toAdminOrder), q.page, q.limit, total), counts, revenue: (revenue[0]?.paise ?? 0) / 100 };
}

/* ---------- Detail ---------- */

async function loadOrder(orderNumber: string) {
  const o = await Order.findOne({ orderNumber }).lean<AdminOrderDoc>();
  if (!o) throw notFound("Order not found.");
  return o;
}

export async function getOrder(orderNumber: string) {
  await connectToDatabase();
  const o = await loadOrder(orderNumber);
  const [attempts, settings] = await Promise.all([
    Payment.find({ order: o._id }, { attempt: 1, status: 1, method: 1, methodDetail: 1, razorpayOrderId: 1, razorpayPaymentId: 1, refundedPaise: 1, createdAt: 1 })
      .sort({ attempt: -1 })
      .lean(),
    StoreSettings.findOne({ key: "store" }, { "shipping.couriers": 1 }).lean<{ shipping?: { couriers?: { name: string; trackingUrlTemplate?: string; enabled?: boolean }[] } }>(),
  ]);
  const paid = attempts.find((a) => a.status === "captured" || a.status === "refunded" || a.status === "partially_refunded");
  return {
    order: toAdminOrder(o),
    payment: {
      paymentId: paid ? String(paid._id) : attempts[0] ? String(attempts[0]._id) : null,
      method: paid?.method ?? null,
      methodDetail: paid?.methodDetail ?? "",
      razorpayOrderId: paid?.razorpayOrderId ?? o.razorpayOrderId ?? null,
      razorpayPaymentId: paid?.razorpayPaymentId ?? null,
      attempts: attempts.length,
    },
    couriers: (settings?.shipping?.couriers ?? [])
      .filter((c) => c.enabled !== false)
      .map((c) => ({ name: c.name, trackingUrlTemplate: c.trackingUrlTemplate ?? "" })),
  };
}

/* ---------- Status changes ---------- */

const isPaid = (o: Pick<AdminOrderDoc, "paymentStatus">) => o.paymentStatus === "captured" || o.paymentStatus === "partially_refunded";

/**
 * Moves an order one step along fulfilment. Rules (server-side, whatever the UI offers):
 * forward only; only paid orders move forward; "Shipped" needs tracking; cancel only before it
 * ships. Cancelling an unpaid order first asks Razorpay (never cancel a paid or in-flight payment)
 * and then releases its reserved stock and coupon use. Cancelling a paid order returns its units to
 * stock (ledger "return") — the refund is a separate, gateway-confirmed step in Payments.
 */
export async function updateOrderStatus(orderNumber: string, input: z.output<typeof orderStatusBody>, actor: AuditActor) {
  await connectToDatabase();
  const target = DB_STATUS_FOR[input.status as AdminOrderStatus];
  const order = await loadOrder(orderNumber);
  const from = order.status as DbOrderStatus;
  const next = FULFILMENT_NEXT[from] ?? [];
  if (!next.includes(target)) {
    throw new AppError(409, "CONFLICT", `An order that is "${toAdminOrder(order).status}" can't be moved to "${input.status}".`);
  }
  const by = adminActor(actor);

  if (from === "pending_payment") {
    // target is "cancelled" (the only move from here). Ask Razorpay before releasing anything.
    const state = await reconcileOrder(order._id);
    if (state === "paid") throw conflict("This order has just been paid, so it can't be cancelled as unpaid. Reload to see it.");
    if (state !== "unpaid") throw conflict("A payment for this order may still be in progress. Try again in a few minutes.");
    const done = await releaseUnpaidOrder(order._id, "cancelled", by, input.note || "Cancelled by staff before payment");
    if (!done) throw conflict("This order changed meanwhile. Reload and try again.");
  } else {
    if (target !== "cancelled" && !isPaid(order)) throw conflict("Only paid orders can be moved forward.");
    if (target === "shipped" && !order.tracking?.awb) throw badRequest("Add the courier and tracking number before marking the order as shipped.");
    await withTransaction(async (session) => {
      const now = new Date();
      const res = await Order.updateOne(
        { _id: order._id, status: from },
        {
          $set: { status: target, ...(target === "shipped" && !order.tracking?.shippedAt ? { "tracking.shippedAt": now } : {}) },
          $push: { statusHistory: { status: target, at: now, by, note: input.note } },
        },
        { session },
      );
      if (res.modifiedCount !== 1) throw conflict("This order was updated by someone else. Reload and try again.");
      if (target === "cancelled" && !order.stockReleased) {
        const lines = new Map<string, { productId: Types.ObjectId; quantity: number }>();
        for (const i of order.items) {
          const cur = lines.get(i.variantSku);
          if (cur) cur.quantity += i.quantity;
          else lines.set(i.variantSku, { productId: i.product, quantity: i.quantity });
        }
        for (const [sku, l] of lines) {
          await restockVariant(session, { productId: l.productId, sku, quantity: l.quantity, orderId: order._id, actor: by, note: "Order cancelled before shipping — units back in stock" });
        }
      }
    });
  }

  await audit(actor, "order.status", { type: "order", id: orderNumber, label: orderNumber }, { status: { from, to: target }, note: input.note || undefined });
  return getOrder(orderNumber);
}

/** Moves several paid orders to one fulfilment status; orders that can't make that move are skipped. */
export async function bulkUpdateStatus(input: z.output<typeof bulkOrderStatusBody>, actor: AuditActor) {
  const updated: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const id of [...new Set(input.ids)]) {
    try {
      await updateOrderStatus(id, { status: input.status, note: "" }, actor);
      updated.push(id);
    } catch (err) {
      skipped.push({ id, reason: err instanceof AppError ? err.message : "Couldn't update." });
    }
  }
  return { updated, skipped };
}

/* ---------- Tracking & notes ---------- */

export async function setTracking(orderNumber: string, input: z.output<typeof trackingBody>, actor: AuditActor) {
  await connectToDatabase();
  const order = await loadOrder(orderNumber);
  if (!isPaid(order) || ["cancelled", "delivered", "expired", "payment_failed", "pending_payment"].includes(order.status)) {
    throw conflict("Tracking can only be added to paid orders that haven't been delivered or cancelled.");
  }
  const tracking = {
    courier: input.courier,
    awb: input.awb.toUpperCase(),
    url: input.url || "",
    shippedAt: order.tracking?.shippedAt ?? null,
  };
  await Order.updateOne({ _id: order._id }, { $set: { tracking } });
  await audit(actor, "order.tracking", { type: "order", id: orderNumber, label: orderNumber }, {
    from: order.tracking?.awb ? { courier: order.tracking.courier, awb: order.tracking.awb } : null,
    to: { courier: tracking.courier, awb: tracking.awb },
  });
  return getOrder(orderNumber);
}

export async function addOrderNote(orderNumber: string, text: string, actor: AuditActor) {
  await connectToDatabase();
  const res = await Order.updateOne(
    { orderNumber },
    { $push: { notes: { author: { type: "admin", id: actor.adminId ?? undefined, name: actor.name ?? "Admin" }, text, at: new Date() } } },
  );
  if (!res.matchedCount) throw notFound("Order not found.");
  await audit(actor, "order.note", { type: "order", id: orderNumber, label: orderNumber }, { length: text.length });
  return getOrder(orderNumber);
}

export type AdminOrderDetail = Awaited<ReturnType<typeof getOrder>> & { order: AdminOrder };
