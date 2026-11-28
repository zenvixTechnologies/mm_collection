import "server-only";
import type { ClientSession, Types } from "mongoose";
import { RazorpayError, razorpayConfig, razorpayRequest, type RazorpayPayment } from "@/lib/razorpay/server";
import { connectToDatabase } from "@/server/db/connect";
import { withTransaction } from "@/server/db/transaction";
import { AppError, badRequest, conflict, notFound } from "@/server/http/errors";
import { Order } from "@/server/models/order.model";
import { Payment } from "@/server/models/payment.model";
import { WebhookEvent } from "@/server/models/webhook-event.model";
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
      // Webhooks and API answers can arrive late or out of order: a settled refund never goes back to
      // "pending", and only a live read from Razorpay (a sync) may turn a processed one into "failed".
      const stale =
        (r.status === "pending" && refunds[i].status !== "pending") || (r.status === "failed" && refunds[i].status === "processed" && meta.source !== "sync");
      if (stale || (refunds[i].status === r.status && refunds[i].amountPaise === r.amount)) return { changed: false, ...totals(p.amountPaise, refunds) };
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
    // Only the payment that paid the order changes the order. Refunding an extra (duplicate)
    // payment is recorded on that payment alone.
    await Order.updateOne(
      { _id: p.order, razorpayPaymentId: p.razorpayPaymentId, paymentStatus: { $in: ["captured", "partially_refunded", "refunded"] } },
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

/* ---------- Refunds that arrive before their payment ---------- */

/*
 * A refund webhook can beat the record of its payment. Its verified details are saved on the
 * webhook event in the same write that claims the event — before the payment is looked up — and
 * completing a payment looks for saved refunds after its transaction has committed. Each side
 * writes before it reads the other's record, so at least one of them always sees both. Applying
 * goes through applyRefundWebhook, which is safe to repeat and never touches stock or coupons.
 */

export interface StoredRefund {
  refundId: string;
  paymentId: string;
  amountPaise: number;
  currency: string;
  status: RazorpayRefund["status"];
  idempotencyKey?: string | null;
}

/** The fields to keep from a verified refund event, or null if they couldn't be applied later. */
export function toStoredRefund(r: RazorpayRefund | undefined): StoredRefund | null {
  const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 100;
  if (!r || !text(r.id) || !text(r.payment_id) || !text(r.currency)) return null;
  if (!Number.isSafeInteger(r.amount) || r.amount <= 0 || !["pending", "processed", "failed"].includes(r.status)) return null;
  const key = keyOf(r);
  return { refundId: r.id, paymentId: r.payment_id, amountPaise: r.amount, currency: r.currency, status: r.status, idempotencyKey: text(key) ? key : null };
}

const fromStored = (s: StoredRefund): RazorpayRefund => ({
  id: s.refundId,
  payment_id: s.paymentId,
  amount: s.amountPaise,
  currency: s.currency,
  status: s.status,
  ...(s.idempotencyKey ? { notes: { idempotency_key: s.idempotencyKey } } : {}),
});

/** An event left "processing" this long was interrupted. */
export const STALE_EVENT_MS = 5 * 60_000;

/**
 * Applies every saved refund of a payment that is now on record. Events still being handled are
 * included, so one whose own lookup ran too early isn't missed. Never throws for a single event:
 * it stays "deferred" to be tried again, and is counted in `failed`.
 */
export async function applyDeferredRefunds(razorpayPaymentId: string, { deadline }: { deadline?: number } = {}) {
  await connectToDatabase();
  const events = await WebhookEvent.find(
    { provider: "razorpay", "refund.paymentId": razorpayPaymentId, status: { $in: ["deferred", "processing", "failed"] } },
    { refund: 1 },
  )
    .sort({ createdAt: 1, _id: 1 })
    .lean<{ _id: Types.ObjectId; refund: StoredRefund }[]>();
  let applied = 0;
  let failed = 0;
  for (const event of events) {
    if (deadline !== undefined && Date.now() >= deadline) break;
    try {
      const outcome = await applyRefundWebhook(fromStored(event.refund));
      if (outcome === "unknown_payment") break; // still not on record: keep waiting
      const payment = await Payment.findOne({ razorpayPaymentId }, { order: 1 }).lean<{ order: Types.ObjectId }>();
      await WebhookEvent.updateOne(
        { _id: event._id },
        {
          $set: {
            status: outcome === "mismatch" ? "ignored" : "processed",
            error: outcome === "mismatch" ? "The refund doesn't match its payment." : null,
            processedAt: new Date(),
            order: payment?.order ?? null,
          },
        },
      );
      applied++;
    } catch (err) {
      failed++;
      logger.error("refund.deferred_apply_failed", { razorpayPaymentId, refundId: event.refund.refundId, error: serializeError(err) });
      await WebhookEvent.updateOne({ _id: event._id, status: { $ne: "processed" } }, { $set: { status: "deferred", error: (err as Error).message?.slice(0, 1000) ?? "error" } }).catch(() => undefined);
    }
  }
  return { applied, failed };
}

/**
 * Backstop for the cron: saved refunds whose payment is on record but weren't applied. Each run
 * takes at most `limit` payments, least recently tried first (a failed try moves to the back),
 * and starts nothing after `deadline`. Each saved event is tried at most once, and one payment's
 * failure never stops the others. Events are removed by the 90-day retention index, applied or not.
 */
export async function sweepDeferredRefunds({ limit = 100, deadline }: { limit?: number; deadline?: number } = {}) {
  await connectToDatabase();
  const totals = { payments: 0, applied: 0, failed: 0 };
  const waiting = await WebhookEvent.aggregate<{ _id: string }>([
    {
      $match: {
        provider: "razorpay",
        "refund.paymentId": { $type: "string" },
        $or: [{ status: { $in: ["deferred", "failed"] } }, { status: "processing", updatedAt: { $lte: new Date(Date.now() - STALE_EVENT_MS) } }],
      },
    },
    { $group: { _id: "$refund.paymentId", lastTried: { $min: "$updatedAt" } } },
    { $sort: { lastTried: 1, _id: 1 } },
  ]);
  if (!waiting.length) return totals;
  // Refunds of payments that aren't on record keep waiting and don't use up the batch.
  const known = new Set(await Payment.distinct("razorpayPaymentId", { razorpayPaymentId: { $in: waiting.map((w) => w._id) } }));
  for (const { _id: id } of waiting.filter((w) => known.has(w._id)).slice(0, limit)) {
    if (deadline !== undefined && Date.now() >= deadline) break;
    totals.payments++;
    try {
      const result = await applyDeferredRefunds(id, { deadline });
      totals.applied += result.applied;
      totals.failed += result.failed;
    } catch (err) {
      totals.failed++;
      logger.error("refund.sweep_payment_failed", { razorpayPaymentId: id, error: serializeError(err) });
      // Send it to the back of the queue (best effort).
      await WebhookEvent.updateMany({ "refund.paymentId": id, status: { $in: ["deferred", "failed"] } }, { $set: { error: "Retry failed; will be tried again." } }).catch(() => undefined);
    }
  }
  return totals;
}
