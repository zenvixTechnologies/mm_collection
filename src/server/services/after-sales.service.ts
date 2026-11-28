import "server-only";
import { createHash } from "node:crypto";
import { Types, type ClientSession } from "mongoose";
import type { z } from "zod";
import { CANCEL_REASONS, DAMAGED_OR_INCORRECT, RETURN_NEXT, RETURN_REASONS, RETURN_STATUSES, cancelAction, returnRules, type NonReturnable, type ReturnStatus } from "@/lib/after-sales";
import { DAMAGE_CLAIM_HOURS, RETURN_WINDOW_DAYS, isNightwear, isUndergarment } from "@/lib/policies";
import type { AfterSalesView, CustomerReturnRequest, RefundSummary, ReturnLine } from "@/types";
import type { AdminCancellation, AdminReturnRequest } from "@/types/admin";
import { getEnv, isConfigured } from "@/server/config/env";
import { connectToDatabase } from "@/server/db/connect";
import { withTransaction } from "@/server/db/transaction";
import { AppError, conflict, notFound } from "@/server/http/errors";
import { paginationMeta } from "@/server/http/response";
import { sendEmail } from "@/server/integrations/email/resend";
import { orderUpdateEmail } from "@/server/integrations/email/templates";
import { Category } from "@/server/models/category.model";
import { Order } from "@/server/models/order.model";
import { Payment } from "@/server/models/payment.model";
import { Product } from "@/server/models/product.model";
import { ReturnRequest } from "@/server/models/return-request.model";
import { User } from "@/server/models/user.model";
import type { cancelOrderBody, returnListQuery, returnRequestBody, returnStatusBody } from "@/server/validation/after-sales";
import { logger, serializeError } from "@/server/utils/logger";
import { applyStatusMove } from "./admin-order.service";
import { FULFILMENT_NEXT, type AdminOrderDoc, type DbOrderStatus } from "./admin-sales.shared";
import { audit, type AuditActor } from "./audit.service";
import { STATUS_LABEL } from "./order.service";

/**
 * Customer cancellations and return requests. Cancelling uses the same transaction as a staff
 * cancellation (stock goes back once; coupon and payment rules unchanged). Nothing here calls
 * Razorpay or moves money: refunds only happen in Payments, and their progress is read from the
 * payment record.
 */

interface OrderRecord extends AdminOrderDoc {
  razorpayPaymentId?: string | null;
}

const rupees = (paise: number) => paise / 100;

/** The customer's own order. Anyone else's gets the same answer as one that doesn't exist. */
async function ownOrder(userId: string, orderNumber: string, session?: ClientSession) {
  const order = await Order.findOne({ orderNumber, user: userId })
    .session(session ?? null)
    .lean<OrderRecord>();
  if (!order) throw notFound("Order not found.");
  return order;
}

/* ---------- Refund progress ---------- */

type PaymentRefunds = { order: Types.ObjectId; razorpayPaymentId?: string | null; amountPaise: number; refunds?: { amountPaise: number; status: string }[] };

/**
 * What has really been refunded on the payment that paid the order. Read from each refund's own
 * status: the order shows "refunded" as soon as a refund is requested, before it completes.
 */
function summarise(payment: PaymentRefunds | null | undefined): RefundSummary {
  const total = (status: string) => (payment?.refunds ?? []).filter((r) => r.status === status).reduce((n, r) => n + r.amountPaise, 0);
  const processed = total("processed");
  const pending = total("pending");
  const state = !payment ? "none" : processed >= payment.amountPaise ? "refunded" : pending > 0 ? "processing" : processed > 0 ? "partial" : "pending";
  return { state, refunded: rupees(processed), processing: rupees(pending) };
}

async function refundsFor(orders: { _id: Types.ObjectId; razorpayPaymentId?: string | null }[]) {
  const payments = await Payment.find({ order: { $in: orders.map((o) => o._id) }, razorpayPaymentId: { $ne: null } }, { order: 1, razorpayPaymentId: 1, amountPaise: 1, refunds: 1 }).lean<PaymentRefunds[]>();
  // Only the payment that paid the order — not an extra payment flagged for staff.
  return new Map(orders.map((o) => [String(o._id), summarise(payments.find((p) => String(p.order) === String(o._id) && p.razorpayPaymentId === o.razorpayPaymentId))]));
}

/* ---------- Email (real, and only when configured) ---------- */

/** Tells the customer, at their account email. Never fails the action; without email set up it only logs. */
async function notify(userId: string, orderNumber: string, title: string, lines: string[], key: string) {
  try {
    const user = await User.findById(userId, { email: 1, fullName: 1 }).lean();
    if (!user?.email) return;
    const base = (isConfigured("app") ? getEnv("app").NEXT_PUBLIC_APP_URL : undefined)?.replace(/\/$/, "");
    await sendEmail({ to: user.email, ...orderUpdateEmail(user.fullName, orderNumber, title, lines, base ? `${base}/account/orders/${orderNumber}` : null), idempotencyKey: key });
  } catch (err) {
    logger.warn("after_sales.notify_failed", { orderNumber, error: serializeError(err) });
  }
}

/* ---------- Return eligibility ---------- */

const deliveredAt = (o: OrderRecord) => {
  const entry = o.statusHistory?.find((h) => h.status === "delivered");
  return entry ? new Date(entry.at) : null;
};

/** A delivered order whose money is still held, at least in part. */
const returnableOrder = (o: OrderRecord) =>
  o.status === "delivered" && (o.paymentStatus === "captured" || o.paymentStatus === "partially_refunded") && (o.refundedPaise ?? 0) < o.totalPaise;

/** Lines the policy marks non-returnable, judged from the order line and its product's categories. */
async function nonReturnableLines(order: OrderRecord, session?: ClientSession) {
  const items = order.items as (OrderRecord["items"][number] & { _id: Types.ObjectId; category?: Types.ObjectId })[];
  const products = await Product.find({ _id: { $in: items.map((i) => i.product) } }, { category: 1, tags: 1 })
    .session(session ?? null)
    .lean<{ _id: Types.ObjectId; category?: Types.ObjectId; tags?: Types.ObjectId[] }[]>();
  const productById = new Map(products.map((p) => [String(p._id), p]));
  const categoryIds = [...items.map((i) => i.category), ...products.flatMap((p) => [p.category, ...(p.tags ?? [])])].filter(Boolean);
  const categories = await Category.find({ _id: { $in: categoryIds } }, { slug: 1 })
    .session(session ?? null)
    .lean();
  const slugOf = new Map(categories.map((c) => [String(c._id), c.slug as string]));
  return new Map<string, NonReturnable>(
    items.map((i) => {
      const product = productById.get(String(i.product));
      const slugs = [i.category, product?.category, ...(product?.tags ?? [])].map((id) => slugOf.get(String(id)) ?? "").filter(Boolean);
      const kind = isUndergarment({ name: i.name, categoryId: (slugs[0] ?? "") as never }) ? "undergarment" : isNightwear(i.name, slugs) ? "nightwear" : null;
      return [String(i._id), kind];
    }),
  );
}

type ReturnDoc = {
  _id: Types.ObjectId;
  order: Types.ObjectId;
  orderNumber: string;
  user: Types.ObjectId;
  itemId: Types.ObjectId;
  variantSku: string;
  product: Types.ObjectId;
  name: string;
  size?: string | null;
  color?: string | null;
  unitPricePaise: number;
  quantity: number;
  reason: keyof typeof RETURN_REASONS;
  explanation?: string;
  comments?: string;
  deliveredAt: Date;
  withinClaimWindow?: boolean | null;
  status: ReturnStatus;
  history: { status: ReturnStatus; at: Date; by?: { type?: string; name?: string } }[];
  adminNotes?: { _id: Types.ObjectId; author?: { name?: string }; text: string; at: Date }[];
  createdAt: Date;
};

/** What the customer sees: an explicit allow-list, so staff notes and names can't leak. */
const toCustomerReturn = (r: ReturnDoc): CustomerReturnRequest => ({
  id: String(r._id),
  name: r.name,
  size: r.size ?? null,
  color: r.color ?? null,
  quantity: r.quantity,
  reason: RETURN_REASONS[r.reason],
  explanation: r.explanation ?? "",
  comments: r.comments ?? "",
  status: r.status,
  statusLabel: RETURN_STATUSES[r.status],
  requestedAt: new Date(r.createdAt).toISOString(),
  history: r.history.map((h) => ({ status: RETURN_STATUSES[h.status], at: new Date(h.at).toISOString() })),
});

/* ---------- The customer's order page ---------- */

export async function getAfterSales(userId: string, orderNumber: string): Promise<AfterSalesView> {
  await connectToDatabase();
  const order = await ownOrder(userId, orderNumber);
  const status = STATUS_LABEL[order.status as DbOrderStatus];
  const requests = await ReturnRequest.find({ order: order._id, user: userId }).sort({ createdAt: -1 }).lean<ReturnDoc[]>();
  const paidBack = (await refundsFor([order])).get(String(order._id))!;
  const cancellation = order.cancellation?.reason
    ? {
        reason: CANCEL_REASONS[order.cancellation.reason],
        otherReason: order.cancellation.otherReason ?? "",
        details: order.cancellation.details ?? "",
        requestedAt: new Date(order.cancellation.requestedAt).toISOString(),
      }
    : null;

  let lines: ReturnLine[] = [];
  const delivered = deliveredAt(order);
  if (returnableOrder(order)) {
    const kinds = await nonReturnableLines(order);
    const now = new Date();
    lines = (order.items as (OrderRecord["items"][number] & { _id: Types.ObjectId })[]).map((i) => {
      const used = requests.filter((r) => String(r.itemId) === String(i._id)).reduce((n, r) => n + r.quantity, 0);
      const left = Math.max(0, i.quantity - used);
      const rules = returnRules(kinds.get(String(i._id)) ?? null, delivered, now);
      return {
        itemId: String(i._id),
        name: i.name,
        size: i.size ?? null,
        color: i.color ?? null,
        quantity: i.quantity,
        returnableQuantity: left && rules.reasons.length ? left : 0,
        reasons: left ? rules.reasons : [],
        message: left ? rules.message : "A return has already been requested for this item.",
      };
    });
  }

  return {
    orderStatus: status,
    // A paid, unshipped order — the only kind a customer may cancel.
    cancel: cancelAction(status),
    cancellation,
    // Shown once an order is cancelled with money taken, or has any refund.
    refund: (order.status === "cancelled" && paidBack.state !== "none") || paidBack.refunded > 0 || paidBack.processing > 0 ? paidBack : null,
    returnWindowEndsAt: delivered ? new Date(delivered.getTime() + RETURN_WINDOW_DAYS * 86_400_000).toISOString() : null,
    lines,
    requests: requests.map(toCustomerReturn),
  };
}

/* ---------- Cancel ---------- */

/** Cancels the signed-in customer's own order before it ships. The status is checked in the database, atomically. */
export async function cancelByCustomer(userId: string, orderNumber: string, input: z.output<typeof cancelOrderBody>) {
  await connectToDatabase();
  const order = await ownOrder(userId, orderNumber);
  const from = order.status as DbOrderStatus;
  if (from === "cancelled") throw conflict("This order has already been cancelled.");
  if (from === "shipped" || from === "out_for_delivery" || from === "delivered") throw conflict("This order has shipped, so it can no longer be cancelled.");
  if (cancelAction(STATUS_LABEL[from]) !== "on" || !FULFILMENT_NEXT[from]?.includes("cancelled")) throw conflict("This order can't be cancelled.");

  const user = await User.findById(userId, { fullName: 1 }).lean();
  const label = CANCEL_REASONS[input.reason];
  try {
    await applyStatusMove(order, from, "cancelled", { type: "customer", id: new Types.ObjectId(userId), name: user?.fullName ?? "Customer" }, `Cancelled by customer: ${label}`, {
      cancellation: {
        customer: new Types.ObjectId(userId),
        reason: input.reason,
        otherReason: input.reason === "other" ? input.otherReason : "",
        details: input.details,
        requestedAt: new Date(),
        statusAtRequest: from,
      },
    });
  } catch (err) {
    if (!(err instanceof AppError) || err.status !== 409) throw err;
    // Someone changed the order at the same moment: say what actually happened.
    const now = await ownOrder(userId, orderNumber);
    if (now.status === "cancelled") throw conflict("This order has already been cancelled.");
    if (cancelAction(STATUS_LABEL[now.status as DbOrderStatus]) !== "on") throw conflict("This order has shipped, so it can no longer be cancelled.");
    throw conflict("This order changed just now. Please try again.");
  }

  await notify(userId, orderNumber, "Your order was cancelled", [`Reason: ${label}`, "If you paid for this order, the refund is handled separately by our team. Your order page shows its progress."], `cancel-${String(order._id)}`);
  return getAfterSales(userId, orderNumber);
}

/* ---------- Request a return ---------- */

/** One request per order line and submission; the ID makes two simultaneous submissions collide. */
const requestId = (orderId: Types.ObjectId, itemId: string, n: number) => new Types.ObjectId(createHash("sha256").update(`return:${String(orderId)}:${itemId.toLowerCase()}:${n}`).digest("hex").slice(0, 24));

export async function createReturnRequest(userId: string, orderNumber: string, input: z.output<typeof returnRequestBody>) {
  await connectToDatabase();
  let created: Types.ObjectId;
  try {
    created = await withTransaction(async (session) => {
      const order = await ownOrder(userId, orderNumber, session);
      if (order.status !== "delivered") throw new AppError(403, "FORBIDDEN", "You can request a return only after the order is delivered.");
      if (!returnableOrder(order)) throw new AppError(403, "FORBIDDEN", "This order can't be returned: its payment has been fully refunded or isn't confirmed.");
      const item = (order.items as (OrderRecord["items"][number] & { _id: Types.ObjectId })[]).find((i) => String(i._id) === input.itemId.toLowerCase());
      if (!item) throw new AppError(403, "FORBIDDEN", "That product isn't part of this order.");

      const earlier = await ReturnRequest.find({ order: order._id, itemId: item._id }, { quantity: 1 }).session(session).lean();
      const left = item.quantity - earlier.reduce((n, r) => n + r.quantity, 0);
      if (left <= 0) throw conflict("A return has already been requested for this item.");
      if (input.quantity > left) throw conflict(`You can request a return for ${left} of this item.`);

      const delivered = deliveredAt(order);
      const now = new Date();
      const rules = returnRules((await nonReturnableLines(order, session)).get(String(item._id)) ?? null, delivered, now);
      if (!rules.reasons.includes(input.reason)) throw new AppError(403, "FORBIDDEN", rules.message ?? "This item can't be returned for that reason.");

      const by = { type: "customer" as const, id: new Types.ObjectId(userId), name: order.customer.fullName };
      const [doc] = await ReturnRequest.create(
        [
          {
            _id: requestId(order._id, input.itemId, earlier.length),
            order: order._id,
            orderNumber,
            user: userId,
            itemId: item._id,
            product: item.product,
            variantSku: item.variantSku,
            name: item.name,
            size: item.size ?? null,
            color: item.color ?? null,
            unitPricePaise: item.unitPricePaise,
            quantity: input.quantity,
            reason: input.reason,
            explanation: input.explanation,
            comments: input.comments,
            deliveredAt: delivered!,
            withinClaimWindow: DAMAGED_OR_INCORRECT.includes(input.reason) ? now.getTime() - delivered!.getTime() <= DAMAGE_CLAIM_HOURS * 3_600_000 : null,
            status: "requested",
            history: [{ status: "requested", at: now, by }],
          },
        ],
        { session },
      );
      return doc._id as Types.ObjectId;
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw conflict("A return has already been requested for this item.");
    throw err;
  }
  await notify(userId, orderNumber, "We received your return request", ["Our team will review it. Your order page shows its status."], `return-${String(created)}`);
  return getAfterSales(userId, orderNumber);
}

/* ---------- Admin ---------- */

async function toAdminReturns(docs: ReturnDoc[]): Promise<AdminReturnRequest[]> {
  const orders = await Order.find({ _id: { $in: docs.map((d) => d.order) } }, { customer: 1, status: 1, paymentStatus: 1, razorpayPaymentId: 1 }).lean<OrderRecord[]>();
  const orderById = new Map(orders.map((o) => [String(o._id), o]));
  const refunds = await refundsFor(orders);
  return docs.map((d) => {
    const order = orderById.get(String(d.order));
    return {
      ...toCustomerReturn(d),
      orderNumber: d.orderNumber,
      customerName: order?.customer.fullName ?? "",
      customerEmail: order?.customer.email ?? "",
      sku: d.variantSku,
      unitPrice: rupees(d.unitPricePaise),
      deliveredAt: new Date(d.deliveredAt).toISOString(),
      withinClaimWindow: d.withinClaimWindow ?? null,
      refund: refunds.get(String(d.order)) ?? null,
      allowedStatuses: RETURN_NEXT[d.status],
      history: d.history.map((h) => ({ status: RETURN_STATUSES[h.status], at: new Date(h.at).toISOString(), by: h.by?.name ?? "system" })),
      adminNotes: (d.adminNotes ?? []).map((n) => ({ id: String(n._id), author: n.author?.name ?? "Staff", text: n.text, createdAt: new Date(n.at).toISOString() })),
    };
  });
}

export async function adminListReturns(q: z.output<typeof returnListQuery>) {
  await connectToDatabase();
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.order) filter.orderNumber = q.order;
  const [docs, total] = await Promise.all([
    ReturnRequest.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean<ReturnDoc[]>(),
    ReturnRequest.countDocuments(filter),
  ]);
  return { items: await toAdminReturns(docs), meta: paginationMeta(q.page, q.limit, total) };
}

/** Orders customers cancelled themselves, newest request first. */
export async function adminListCancellations(page: number, limit: number) {
  await connectToDatabase();
  const filter = { "cancellation.reason": { $exists: true } };
  const [docs, total] = await Promise.all([
    Order.find(filter)
      .sort({ "cancellation.requestedAt": -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean<OrderRecord[]>(),
    Order.countDocuments(filter),
  ]);
  const refunds = await refundsFor(docs);
  const items: AdminCancellation[] = docs.map((o) => ({
    id: o.orderNumber,
    customerName: o.customer.fullName,
    customerEmail: o.customer.email,
    products: o.items.map((i) => `${i.name}${i.size ? ` (${i.size})` : ""} × ${i.quantity}`),
    total: rupees(o.totalPaise),
    reason: CANCEL_REASONS[o.cancellation!.reason],
    otherReason: o.cancellation!.otherReason ?? "",
    details: o.cancellation!.details ?? "",
    requestedAt: new Date(o.cancellation!.requestedAt).toISOString(),
    statusAtRequest: STATUS_LABEL[o.cancellation!.statusAtRequest as DbOrderStatus],
    refund: refunds.get(String(o._id))!,
  }));
  return { items, meta: paginationMeta(page, limit, total) };
}

const staff = (actor: AuditActor) => ({ type: "admin" as const, id: actor.adminId ? new Types.ObjectId(actor.adminId) : undefined, name: actor.name ?? "Admin" });

async function adminReturn(id: string) {
  const doc = await ReturnRequest.findById(id).lean<ReturnDoc>();
  if (!doc) throw notFound("Return request not found.");
  return (await toAdminReturns([doc]))[0];
}

/** Moves a return request one allowed step. Never touches the order, its payment or stock. */
export async function adminUpdateReturn(id: string, input: z.output<typeof returnStatusBody>, actor: AuditActor) {
  await connectToDatabase();
  const doc = await ReturnRequest.findById(id).lean<ReturnDoc>();
  if (!doc) throw notFound("Return request not found.");
  if (!RETURN_NEXT[doc.status].includes(input.status)) throw conflict(`A request that is "${RETURN_STATUSES[doc.status]}" can't be moved to "${RETURN_STATUSES[input.status]}".`);
  const now = new Date();
  const by = staff(actor);
  const res = await ReturnRequest.updateOne(
    { _id: doc._id, status: doc.status },
    {
      $set: { status: input.status },
      $push: { history: { status: input.status, at: now, by }, ...(input.note ? { adminNotes: { author: by, text: input.note, at: now } } : {}) },
    },
  );
  if (res.modifiedCount !== 1) throw conflict("This request was updated by someone else. Reload and try again.");
  await audit(actor, "return.status", { type: "return", id, label: doc.orderNumber }, { status: { from: doc.status, to: input.status } });
  await notify(String(doc.user), doc.orderNumber, RETURN_STATUSES[input.status], [`Item: ${doc.name} × ${doc.quantity}`, "Your order page shows the current status."], `return-${id}-${input.status}`);
  return adminReturn(id);
}

export async function adminAddReturnNote(id: string, text: string, actor: AuditActor) {
  await connectToDatabase();
  const res = await ReturnRequest.updateOne({ _id: id }, { $push: { adminNotes: { author: staff(actor), text, at: new Date() } } });
  if (!res.matchedCount) throw notFound("Return request not found.");
  await audit(actor, "return.note", { type: "return", id }, { length: text.length });
  return adminReturn(id);
}
