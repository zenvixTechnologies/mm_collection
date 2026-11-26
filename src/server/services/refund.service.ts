import "server-only";
import type { ClientSession, Types } from "mongoose";
import { RazorpayError, razorpayConfig, razorpayRequest, type RazorpayPayment } from "@/lib/razorpay/server";
import { connectToDatabase } from "@/server/db/connect";
import { withTransaction } from "@/server/db/transaction";
import { AppError, badRequest, conflict, notFound } from "@/server/http/errors";
import { Order } from "@/server/models/order.model";
import { Payment } from "@/server/models/payment.model";
import { logger, serializeError } from "@/server/utils/logger";
import { audit, type AuditActor } from "./audit.service";

/**
 * Razorpay refunds. Money only moves through Razorpay's refund API, and our records change only
 * from Razorpay's own answers: the refund-creation response, a verified `refund.*` webhook, or a
 * status sync that reads the refund back from Razorpay. Nothing is ever marked refunded locally on
 * an admin's say-so.
 *
 * Safety: one refund at a time per payment (a short lock), and every admin request carries an
 * idempotency key — stored with the refund and sent to Razorpay in its notes — so a retried or
 * double-clicked request never refunds twice, even if the first response was lost.
 */

export interface RazorpayRefund {
  id: string;
  entity?: string;
  amount: number;
  currency: string;
  payment_id: string;
  status: "pending" | "processed" | "failed";
  notes?: Record<string, string> | [];
  created_at?: number;
}

interface RefundRow {
  razorpayRefundId: string;
  amountPaise: number;
  status: "pending" | "processed" | "failed";
  reason?: string;
  idempotencyKey?: string | null;
}

interface PaymentRow {
  _id: Types.ObjectId;
  order: Types.ObjectId;
  orderNumber: string;
  razorpayPaymentId?: string | null;
  amountPaise: number;
  status: string;
  refunds?: RefundRow[];
}

const LOCK_MS = 30_000;
const GATEWAY_TIMEOUT_MS = 15_000;

const keyOf = (r: RazorpayRefund) => (r.notes && !Array.isArray(r.notes) ? r.notes.idempotency_key : undefined);

/** Refund totals → payment/order status. Failed refunds don't count. */
function totals(amountPaise: number, refunds: RefundRow[]) {
  const refundedPaise = refunds.filter((r) => r.status !== "failed").reduce((s, r) => s + r.amountPaise, 0);
  const status = refundedPaise <= 0 ? "captured" : refundedPaise >= amountPaise ? "refunded" : "partially_refunded";
  return { refundedPaise, status };
}

/** Writes a Razorpay-confirmed refund (new or updated) and recomputes payment + order totals, atomically. */
async function recordRefund(paymentId: Types.ObjectId, r: RazorpayRefund, meta: { reason?: string; adminId?: string | null; idempotencyKey?: string | null; source: "admin" | "webhook" | "sync" }) {
  return withTransaction(async (session: ClientSession) => {
    const p = await Payment.findById(paymentId).session(session).lean<PaymentRow>();
    if (!p) throw notFound("Payment not found.");
    const refunds = [...(p.refunds ?? [])];
    const i = refunds.findIndex((x) => x.razorpayRefundId === r.id);
    const row = {
      razorpayRefundId: r.id,
      amountPaise: r.amount,
      status: r.status,
      reason: (i >= 0 ? refunds[i].reason : meta.reason) ?? "",
      idempotencyKey: (i >= 0 ? refunds[i].idempotencyKey : meta.idempotencyKey) ?? keyOf(r) ?? null,
    };
    if (i >= 0) {
      if (refunds[i].status === r.status && refunds[i].amountPaise === r.amount) return { changed: false, ...totals(p.amountPaise, refunds) };
      refunds[i] = { ...refunds[i], ...row };
      await Payment.updateOne(
        { _id: p._id, "refunds.razorpayRefundId": r.id },
        { $set: { "refunds.$.status": r.status, "refunds.$.amountPaise": r.amount, ...(r.status === "processed" ? { "refunds.$.processedAt": new Date() } : {}) } },
        { session },
      );
    } else {
      refunds.push(row);
      await Payment.updateOne(
        { _id: p._id, "refunds.razorpayRefundId": { $ne: r.id } },
        {
          $push: {
            refunds: { ...row, initiatedBy: meta.adminId ?? null, source: meta.source, processedAt: r.status === "processed" ? new Date() : null },
          },
        },
        { session },
      );
    }
    const t = totals(p.amountPaise, refunds);
    await Payment.updateOne({ _id: p._id }, { $set: { refundedPaise: t.refundedPaise, status: t.status } }, { session });
    await Order.updateOne(
      { _id: p.order, paymentStatus: { $in: ["captured", "partially_refunded", "refunded"] } },
      { $set: { refundedPaise: t.refundedPaise, paymentStatus: t.status } },
      { session },
    );
    return { changed: true, ...t };
  });
}

function checkRefund(r: RazorpayRefund, p: PaymentRow, expectedPaise?: number) {
  if (r.payment_id !== p.razorpayPaymentId) return "Refund belongs to a different payment.";
  if (r.currency !== "INR") return "Refund currency isn't INR.";
  if (expectedPaise !== undefined && r.amount !== expectedPaise) return `Refund amount ${r.amount} doesn't match the request (${expectedPaise}).`;
  if (!["pending", "processed", "failed"].includes(r.status)) return `Unknown refund status "${r.status}".`;
  return null;
}

/**
 * Refunds (part of) a captured payment through Razorpay. `amountPaise` omitted = everything still
 * refundable. Returns the refund as recorded from Razorpay's response.
 */
export async function createRefund(
  paymentId: string,
  input: { amountPaise?: number; reason: string; idempotencyKey: string },
  actor: AuditActor,
) {
  const config = razorpayConfig();
  await connectToDatabase();
  const load = () => Payment.findById(paymentId, { order: 1, orderNumber: 1, razorpayPaymentId: 1, amountPaise: 1, status: 1, refunds: 1 }).lean<PaymentRow>();
  let p = await load();
  if (!p) throw notFound("Payment not found.");
  const already = p.refunds?.find((r) => r.idempotencyKey === input.idempotencyKey);
  if (already) return { refund: already, replayed: true };
  if (!p.razorpayPaymentId || !["captured", "partially_refunded"].includes(p.status)) throw conflict("Only captured payments can be refunded.");

  const now = new Date();
  const locked = await Payment.findOneAndUpdate(
    { _id: p._id, $or: [{ refundLockUntil: null }, { refundLockUntil: { $lte: now } }] },
    { $set: { refundLockUntil: new Date(now.getTime() + LOCK_MS) } },
    { projection: { _id: 1 } },
  ).lean();
  if (!locked) throw conflict("A refund for this payment is already being processed. Please wait a moment.");

  try {
    // Re-read after locking: a request with the same key may have just finished.
    p = (await load())!;
    const done = p.refunds?.find((r) => r.idempotencyKey === input.idempotencyKey);
    if (done) return { refund: done, replayed: true };

    // Razorpay's own view of what is still refundable.
    const rp = await razorpayRequest<RazorpayPayment & { amount_refunded?: number }>(config, `/payments/${encodeURIComponent(p.razorpayPaymentId!)}`, { timeoutMs: GATEWAY_TIMEOUT_MS }).catch(
      (err: unknown) => {
        logger.error("refund.payment_lookup_failed", { paymentId, error: serializeError(err) });
        throw err instanceof RazorpayError && err.status === 400
          ? conflict("Razorpay couldn't find this payment, so it can't be refunded from here. Check the Razorpay Dashboard.")
          : new AppError(502, "SERVICE_UNAVAILABLE", "We couldn't reach Razorpay to check this payment. Nothing was refunded — please try again.", { cause: err });
      },
    );
    if (rp.status !== "captured" && rp.status !== "refunded") throw conflict("Razorpay doesn't show this payment as captured, so it can't be refunded.");
    const remaining = rp.amount - (rp.amount_refunded ?? 0);
    if (remaining <= 0) throw conflict("This payment has already been fully refunded.");
    const amount = input.amountPaise ?? remaining;
    if (amount > remaining) throw badRequest(`You can refund at most ₹${(remaining / 100).toFixed(2)} on this payment.`);

    let refund: RazorpayRefund;
    try {
      refund = await razorpayRequest<RazorpayRefund>(config, `/payments/${encodeURIComponent(p.razorpayPaymentId!)}/refund`, {
        method: "POST",
        body: { amount, speed: "normal", notes: { store_order_id: p.orderNumber, idempotency_key: input.idempotencyKey, reason: input.reason.slice(0, 200) } },
        timeoutMs: GATEWAY_TIMEOUT_MS,
      });
    } catch (err) {
      // The request may have reached Razorpay even though we got no answer — look before failing.
      const found = await findRefundByKey(config, p.razorpayPaymentId!, input.idempotencyKey).catch(() => null);
      if (!found) {
        logger.error("refund.create_failed", { paymentId, error: serializeError(err) });
        throw err instanceof RazorpayError && err.status === 400
          ? badRequest(`Razorpay refused the refund: ${err.message}`)
          : new AppError(502, "SERVICE_UNAVAILABLE", "We couldn't reach Razorpay to create the refund. Nothing was refunded — please try again.", { cause: err });
      }
      refund = found;
    }

    const problem = checkRefund(refund, p, amount);
    if (problem) {
      logger.error("refund.response_mismatch", { paymentId, refundId: refund.id, problem });
      if (refund.payment_id !== p.razorpayPaymentId) throw new AppError(502, "SERVICE_UNAVAILABLE", "Razorpay returned an unexpected refund. Please check the Razorpay Dashboard.");
    }
    await recordRefund(p._id, refund, { reason: input.reason, adminId: actor.adminId, idempotencyKey: input.idempotencyKey, source: "admin" });
    await audit(actor, "payment.refund", { type: "payment", id: paymentId, label: p.orderNumber }, {
      razorpayRefundId: refund.id,
      amountPaise: refund.amount,
      status: refund.status,
      reason: input.reason,
    });
    const after = await load();
    return { refund: after?.refunds?.find((r) => r.razorpayRefundId === refund.id) ?? refund, replayed: false };
  } finally {
    await Payment.updateOne({ _id: p._id }, { $set: { refundLockUntil: null } }).catch(() => undefined);
  }
}

async function findRefundByKey(config: ReturnType<typeof razorpayConfig>, razorpayPaymentId: string, key: string) {
  const list = await razorpayRequest<{ items: RazorpayRefund[] }>(config, `/payments/${encodeURIComponent(razorpayPaymentId)}/refunds?count=100`, { timeoutMs: GATEWAY_TIMEOUT_MS });
  return list.items?.find((r) => keyOf(r) === key) ?? null;
}

/** Reads one refund back from Razorpay and records its current status (e.g. pending → processed). */
export async function syncRefund(paymentId: string, razorpayRefundId: string, actor: AuditActor) {
  const config = razorpayConfig();
  await connectToDatabase();
  const p = await Payment.findById(paymentId, { order: 1, orderNumber: 1, razorpayPaymentId: 1, amountPaise: 1, status: 1, refunds: 1 }).lean<PaymentRow>();
  if (!p?.razorpayPaymentId) throw notFound("Payment not found.");
  if (!p.refunds?.some((r) => r.razorpayRefundId === razorpayRefundId)) throw notFound("Refund not found on this payment.");
  const r = await razorpayRequest<RazorpayRefund>(config, `/payments/${encodeURIComponent(p.razorpayPaymentId)}/refunds/${encodeURIComponent(razorpayRefundId)}`, {
    timeoutMs: GATEWAY_TIMEOUT_MS,
  }).catch((err) => {
    throw new AppError(502, "SERVICE_UNAVAILABLE", "We couldn't reach Razorpay. Please try again.", { cause: err });
  });
  const problem = checkRefund(r, p);
  if (problem) throw new AppError(502, "SERVICE_UNAVAILABLE", "Razorpay returned an unexpected refund. Please check the Razorpay Dashboard.");
  const result = await recordRefund(p._id, r, { source: "sync" });
  if (result.changed) await audit(actor, "payment.refund_sync", { type: "payment", id: paymentId, label: p.orderNumber }, { razorpayRefundId, status: r.status });
  return r;
}

/**
 * Verified `refund.created` / `refund.processed` / `refund.failed` webhooks (also refunds issued
 * from the Razorpay Dashboard). Idempotent: an unchanged refund is a no-op.
 */
export async function applyRefundWebhook(r: RazorpayRefund) {
  await connectToDatabase();
  const p = await Payment.findOne({ razorpayPaymentId: r.payment_id }, { order: 1, orderNumber: 1, razorpayPaymentId: 1, amountPaise: 1, status: 1, refunds: 1 }).lean<PaymentRow>();
  if (!p) return "unknown_payment" as const;
  if (checkRefund(r, p)) return "mismatch" as const;
  const result = await recordRefund(p._id, r, { source: "webhook" });
  return result.changed ? ("recorded" as const) : ("unchanged" as const);
}
