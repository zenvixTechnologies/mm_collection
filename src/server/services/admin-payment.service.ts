import "server-only";
import { Types, type PipelineStage } from "mongoose";
import type { z } from "zod";
import type { PaymentDetailView, PaymentRefund, PaymentStatus, PaymentTransaction } from "@/types/admin";
import { connectToDatabase } from "@/server/db/connect";
import { notFound } from "@/server/http/errors";
import { Admin } from "@/server/models/admin.model";
import { Order } from "@/server/models/order.model";
import { Payment } from "@/server/models/payment.model";
import { WebhookEvent } from "@/server/models/webhook-event.model";
import type { paymentListQuery } from "@/server/validation/admin-sales";
import { dateRange, escapeRegex, pageOf, toAdminOrder, type AdminOrderDoc } from "./admin-sales.shared";

/**
 * Admin payments: every Razorpay payment attempt with its store order and customer. Read-only
 * except refunds (refund.service). Card, UPI and bank details are never stored, so never shown.
 */

interface PaymentAgg {
  _id: Types.ObjectId;
  orderNumber: string;
  attempt?: number;
  razorpayOrderId: string;
  razorpayPaymentId?: string | null;
  amountPaise: number;
  feePaise?: number;
  taxPaise?: number;
  refundedPaise?: number;
  status: string;
  mode: "test" | "live";
  method?: string | null;
  methodDetail?: string;
  errorDescription?: string | null;
  verifiedBy?: PaymentTransaction["verifiedBy"];
  capturedAt?: Date | null;
  createdAt: Date;
  ord?: { user?: Types.ObjectId | null; customer?: { fullName: string; email: string } }[];
}

function toTransaction(p: PaymentAgg): PaymentTransaction {
  const o = p.ord?.[0];
  return {
    id: String(p._id),
    razorpayPaymentId: p.razorpayPaymentId ?? "",
    razorpayOrderId: p.razorpayOrderId,
    orderId: p.orderNumber,
    customerId: o?.user ? String(o.user) : "",
    customerName: o?.customer?.fullName ?? "",
    email: o?.customer?.email ?? "",
    method: (p.method ?? "upi") as PaymentTransaction["method"],
    methodDetail: p.methodDetail ?? "",
    amount: p.amountPaise / 100,
    fee: ((p.feePaise ?? 0) + (p.taxPaise ?? 0)) / 100,
    refundedAmount: (p.refundedPaise ?? 0) / 100,
    status: p.status as PaymentStatus,
    mode: p.mode,
    createdAt: new Date(p.createdAt).toISOString(),
    errorReason: p.status === "captured" ? undefined : (p.errorDescription ?? undefined),
    attempt: p.attempt ?? 1,
    verifiedBy: p.verifiedBy ?? null,
    capturedAt: p.capturedAt ? new Date(p.capturedAt).toISOString() : null,
  };
}

const JOIN_ORDER: PipelineStage[] = [
  { $lookup: { from: "orders", localField: "order", foreignField: "_id", as: "ord", pipeline: [{ $project: { user: 1, customer: 1 } }] } },
];

const GROUP_STATUSES = { paid: ["captured"], failed: ["failed"], refunded: ["refunded", "partially_refunded"] } as const;

export async function listPayments(q: z.output<typeof paymentListQuery>) {
  await connectToDatabase();
  const base: Record<string, unknown> = {};
  const created = dateRange(q.from, q.to);
  if (created) base.createdAt = created;
  if (q.mode) base.mode = q.mode;
  if (q.method) base.method = q.method;
  if (q.status) base.status = q.status;
  else if (q.group) base.status = { $in: [...GROUP_STATUSES[q.group]] };

  const search: Record<string, unknown>[] = [];
  if (q.q) {
    const term = escapeRegex(q.q);
    search.push(
      { orderNumber: { $regex: `^${escapeRegex(q.q.toUpperCase())}` } },
      { razorpayPaymentId: { $regex: `^${term}`, $options: "i" } },
      { razorpayOrderId: { $regex: `^${term}`, $options: "i" } },
      { "ord.customer.fullName": { $regex: term, $options: "i" } },
      { "ord.customer.email": { $regex: term, $options: "i" } },
    );
  }
  const dir = q.dir === "asc" ? 1 : -1;
  const [res] = await Payment.aggregate<{ rows: PaymentAgg[]; total: { n: number }[] }>([
    { $match: base },
    ...JOIN_ORDER,
    ...(search.length ? [{ $match: { $or: search } }] : []),
    {
      $facet: {
        rows: [{ $sort: { [q.sort === "amount" ? "amountPaise" : "createdAt"]: dir, _id: -1 } }, { $skip: (q.page - 1) * q.limit }, { $limit: q.limit }],
        total: [{ $count: "n" }],
      },
    },
  ]);

  // Headline figures and tab counts over all payments (not just this page or filter).
  const [stats] = await Payment.aggregate<{ byStatus: { _id: string; n: number; paise: number; refunded: number }[] }>([
    { $facet: { byStatus: [{ $group: { _id: "$status", n: { $sum: 1 }, paise: { $sum: "$amountPaise" }, refunded: { $sum: { $ifNull: ["$refundedPaise", 0] } } } }] } },
  ]);
  const by = (s: string) => stats?.byStatus.find((x) => x._id === s) ?? { n: 0, paise: 0, refunded: 0 };
  const paidLike = ["captured", "partially_refunded", "refunded"].map(by);
  const collectedPaise = paidLike.reduce((s, x) => s + x.paise - x.refunded, 0);
  const successful = paidLike.reduce((s, x) => s + x.n, 0);
  const failed = by("failed").n;
  const all = (stats?.byStatus ?? []).reduce((s, x) => s + x.n, 0);
  const summary = {
    collected: collectedPaise / 100,
    successful,
    failed,
    refunded: paidLike.reduce((s, x) => s + x.refunded, 0) / 100,
    successRate: successful + failed ? (successful / (successful + failed)) * 100 : 0,
    counts: { all, paid: by("captured").n, failed, refunded: by("refunded").n + by("partially_refunded").n },
  };
  return { ...pageOf((res?.rows ?? []).map(toTransaction), q.page, q.limit, res?.total?.[0]?.n ?? 0), summary };
}

export async function getPayment(id: string): Promise<PaymentDetailView> {
  await connectToDatabase();
  const [p] = await Payment.aggregate<
    PaymentAgg & {
      order: Types.ObjectId;
      failures?: { razorpayPaymentId: string; code?: string | null; description?: string | null; method?: string | null; source: string; at: Date }[];
      refunds?: { razorpayRefundId: string; amountPaise: number; status: PaymentRefund["status"]; reason?: string; source?: PaymentRefund["source"]; initiatedBy?: Types.ObjectId | null; createdAt?: Date; processedAt?: Date | null }[];
    }
  >([{ $match: { _id: new Types.ObjectId(id) } }, ...JOIN_ORDER]);
  if (!p) throw notFound("Payment not found.");

  const adminIds = [...new Set((p.refunds ?? []).map((r) => r.initiatedBy).filter(Boolean).map(String))];
  const [order, webhooks, admins] = await Promise.all([
    Order.findById(p.order).lean<AdminOrderDoc>(),
    WebhookEvent.find({ $or: [{ razorpayOrderId: p.razorpayOrderId }, ...(p.razorpayPaymentId ? [{ razorpayPaymentId: p.razorpayPaymentId }] : [])] })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
    adminIds.length ? Admin.find({ _id: { $in: adminIds } }, { name: 1 }).lean() : Promise.resolve([]),
  ]);
  const nameOf = new Map(admins.map((a) => [String(a._id), a.name as string]));
  const transaction = toTransaction(p);
  const refundedPaise = p.refundedPaise ?? 0;
  const refundable = ["captured", "partially_refunded"].includes(p.status) && p.razorpayPaymentId ? Math.max(0, p.amountPaise - refundedPaise) / 100 : 0;
  const adminOrder = order ? toAdminOrder(order) : null;

  return {
    payment: transaction,
    failures: (p.failures ?? []).map((f) => ({
      razorpayPaymentId: f.razorpayPaymentId,
      code: f.code ?? null,
      description: f.description ?? null,
      method: f.method ?? null,
      source: f.source,
      at: new Date(f.at).toISOString(),
    })),
    refunds: (p.refunds ?? []).map((r) => ({
      razorpayRefundId: r.razorpayRefundId,
      amount: r.amountPaise / 100,
      status: r.status,
      reason: r.reason ?? "",
      source: r.source ?? "admin",
      by: r.initiatedBy ? (nameOf.get(String(r.initiatedBy)) ?? "Admin") : r.source === "webhook" ? "Razorpay" : null,
      createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
      processedAt: r.processedAt ? new Date(r.processedAt).toISOString() : null,
    })),
    webhooks: webhooks.map((w) => ({
      type: w.type,
      status: w.status,
      attempts: w.attempts ?? 1,
      at: new Date(w.createdAt as Date).toISOString(),
      processedAt: w.processedAt ? new Date(w.processedAt).toISOString() : null,
      error: w.error ?? null,
    })),
    order: adminOrder ? { id: adminOrder.id, status: adminOrder.status, total: adminOrder.total, paymentStatus: adminOrder.paymentStatus } : null,
    refundable,
  };
}
