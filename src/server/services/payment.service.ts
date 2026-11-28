import "server-only";
import { createHash } from "node:crypto";
import type { Types } from "mongoose";
import type { PaymentStart, PaymentStatusView } from "@/types";
import {
  ALLOWED_METHODS,
  RazorpayError,
  getRazorpayConfig,
  razorpayConfig,
  razorpayRequest,
  verifyPaymentSignature,
  verifyWebhookSignature,
  webhookSecret,
  type RazorpayConfig,
  type RazorpayOrder,
  type RazorpayPayment,
} from "@/lib/razorpay/server";
import { connectToDatabase } from "@/server/db/connect";
import { withTransaction } from "@/server/db/transaction";
import { AppError, badRequest } from "@/server/http/errors";
import { Order } from "@/server/models/order.model";
import { Payment } from "@/server/models/payment.model";
import { WebhookEvent } from "@/server/models/webhook-event.model";
import { logger, serializeError } from "@/server/utils/logger";
import { reclaimReleasedCouponUse, redeemCouponUse } from "./coupon.service";
import { STALE_EVENT_MS, applyDeferredRefunds, applyRefundWebhook, toStoredRefund, type RazorpayRefund } from "./refund.service";
import { expireStaleOrders, loadOrderForViewer, paymentStateOf, toOrderView, type ExpiryCheck, type OrderDoc, type OrderViewer } from "./order.service";
import { canSellAvailable, sellAvailableVariant, sellReservedVariant, type StockActor } from "./stock-reservation.service";

/**
 * Razorpay payments for stored orders (India only, INR only).
 *
 * The amount is always the order's stored `totalPaise` — never a browser value or a fresh price.
 * An order becomes paid only on the server, after Razorpay itself says the payment is captured:
 * via the checkout callback (signature verified, payment re-fetched from Razorpay), a verified
 * webhook, or reconciliation against Razorpay's API. Every route into "paid" goes through
 * `completePayment`, one MongoDB transaction that turns the order's reserved stock into a sale
 * (ledger "sale"), finalises its coupon use and marks the order paid — exactly once.
 */

const MIN_TIME_LEFT_MS = 60_000; // don't open Checkout for an order with less than a minute left
const MAX_ATTEMPTS = 10;
const LOCK_MS = 20_000;
/** A payment Razorpay still shows as in progress keeps the stock this long past the hold. */
export const PROCESSING_GRACE_MS = 15 * 60_000;
/** If Razorpay can't be reached at all, the hold is released after this long regardless. */
export const UNREACHABLE_RELEASE_MS = 24 * 60 * 60_000;
const GATEWAY_TIMEOUT_MS = 6_000;

interface AttemptDoc {
  _id: Types.ObjectId;
  order: Types.ObjectId;
  orderNumber: string;
  attempt: number;
  mode: "test" | "live";
  razorpayOrderId: string;
  razorpayPaymentId?: string | null;
  amountPaise: number;
  currency: string;
  status: string;
  failures?: { razorpayPaymentId: string; description?: string | null }[];
  errorDescription?: string | null;
  createdAt: Date;
}

/* ---------- Already paid? ---------- */

/** States that mean money was taken. Refunding it, in part or in full, doesn't undo that. */
const SETTLED_STATUSES = ["captured", "partially_refunded", "refunded"] as const;
const isSettledStatus = (status: string) => (SETTLED_STATUSES as readonly string[]).includes(status);

/** True once any payment has paid for the order — also after refunds. */
const isSettled = (order: Pick<OrderDoc, "paymentStatus" | "razorpayPaymentId">) => !!order.razorpayPaymentId || isSettledStatus(order.paymentStatus);

/* ---------- Gateway calls ---------- */

/** Razorpay/network failures become a safe 502/503; nothing from the gateway reaches the client. */
async function gateway<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    logger.error("razorpay.request_failed", { what, status: err instanceof RazorpayError ? err.status : undefined, error: serializeError(err) });
    if (err instanceof RazorpayError && err.status === 401) {
      throw new AppError(503, "SERVICE_UNAVAILABLE", "Online payments are temporarily unavailable. Please try again later.", { cause: err });
    }
    throw new AppError(502, "SERVICE_UNAVAILABLE", "We couldn't reach the payment service. Please try again.", { cause: err });
  }
}

const allowedMethod = (m: string | null | undefined): m is (typeof ALLOWED_METHODS)[number] => !!m && (ALLOWED_METHODS as readonly string[]).includes(m);

/** Why a Razorpay payment can't pay this order (null = it can). Amount and currency come from our records. */
function paymentProblem(p: RazorpayPayment, order: Pick<OrderDoc, "totalPaise">, attempt: Pick<AttemptDoc, "amountPaise" | "razorpayOrderId">) {
  if (p.order_id !== attempt.razorpayOrderId) return "Payment belongs to a different Razorpay order.";
  if (p.currency !== "INR") return `Payment currency ${p.currency} is not INR.`;
  if (p.amount !== order.totalPaise || p.amount !== attempt.amountPaise) return `Payment amount ${p.amount} doesn't match the order total ${order.totalPaise}.`;
  if (p.international) return "International payment.";
  if (!allowedMethod(p.method)) return `Unsupported payment method "${p.method}".`;
  return null;
}

/** Captures an authorized payment for exactly the stored amount — only if the order is still unpaid and it otherwise checks out. */
async function captureIfAuthorized(config: RazorpayConfig, p: RazorpayPayment, order: OrderDoc, attempt: AttemptDoc): Promise<RazorpayPayment> {
  if (p.status !== "authorized" || isSettled(order) || paymentProblem(p, order, attempt)) return p;
  try {
    return await razorpayRequest<RazorpayPayment>(config, `/payments/${encodeURIComponent(p.id)}/capture`, {
      method: "POST",
      body: { amount: order.totalPaise, currency: "INR" },
      timeoutMs: GATEWAY_TIMEOUT_MS,
    });
  } catch (err) {
    // Already captured elsewhere (auto-capture, a webhook racing us) — read the real state.
    logger.warn("razorpay.capture_failed", { paymentId: p.id, error: serializeError(err) });
    return razorpayRequest<RazorpayPayment>(config, `/payments/${encodeURIComponent(p.id)}`, { timeoutMs: GATEWAY_TIMEOUT_MS });
  }
}

/* ---------- Completing a payment (the only way an order becomes paid) ---------- */

export type CompletionResult = "paid" | "already_paid" | "late_paid" | "late_unfulfillable" | "duplicate" | "mismatch" | "not_captured" | "unknown_order";

const systemActor = (name: string): StockActor => ({ type: "system", name });

function heldLines(order: Pick<OrderDoc, "items">) {
  const lines = new Map<string, { productId: Types.ObjectId; sku: string; quantity: number }>();
  for (const i of order.items) {
    const cur = lines.get(i.variantSku);
    if (cur) cur.quantity += i.quantity;
    else lines.set(i.variantSku, { productId: i.product, sku: i.variantSku, quantity: i.quantity });
  }
  return [...lines.values()];
}

/**
 * Records a payment Razorpay reports as captured. In one transaction: checks the payment belongs
 * to the stored Razorpay order, for the stored amount, in INR, domestic → converts the reserved
 * stock into a sale (or, if the hold had already been released, sells from available stock) →
 * finalises the coupon use → marks the order paid. Safe to call any number of times for the same
 * payment: a payment already on record changes nothing, even after it has been refunded. Any other
 * payment for a paid order is flagged as a duplicate and never touches stock.
 */
export async function completePayment(p: RazorpayPayment, source: "verify" | "webhook" | "reconcile"): Promise<CompletionResult> {
  // "refunded" only gets through so a replay of a recorded payment is recognised below.
  if (p.status !== "captured" && p.status !== "refunded") return "not_captured";
  await connectToDatabase();
  const result = await withTransaction(async (session): Promise<CompletionResult> => {
    const attempt = await Payment.findOne({ razorpayOrderId: p.order_id }).session(session).lean<AttemptDoc>();
    if (!attempt) return "unknown_order";
    const order = await Order.findById(attempt.order).session(session).lean<OrderDoc>();
    if (!order) return "unknown_order";
    // Already on record, as the payment that paid the order or as an extra one: nothing to do.
    if (order.razorpayPaymentId === p.id) return "already_paid";
    if (attempt.razorpayPaymentId === p.id) return "duplicate";
    if (p.status !== "captured") return "not_captured";
    const now = new Date();
    const actor = systemActor(`razorpay ${source}`);

    const problem = paymentProblem(p, order, attempt);
    if (problem) {
      // Money was taken but it doesn't match this order: never mark it paid — flag it for staff.
      await Order.updateOne(
        { _id: order._id },
        { $set: { exception: { code: "PAYMENT_MISMATCH", message: `Payment ${p.id}: ${problem} Refund or review required.`, at: now } } },
        { session },
      );
      await Payment.updateOne({ _id: attempt._id }, { $set: { errorCode: "MISMATCH", errorDescription: problem.slice(0, 500) } }, { session });
      return "mismatch";
    }

    if (isSettled(order)) {
      // A second successful payment for an order that is already paid — must be refunded.
      const message = `Second payment ${p.id} captured for an already-paid order. Refund it.`;
      await Order.updateOne(
        { _id: order._id, "exception.message": { $ne: message } }, // a redelivery doesn't re-flag it
        { $set: { exception: { code: "DUPLICATE_PAYMENT", message, at: now } } },
        { session },
      );
      await Payment.updateOne(
        { _id: attempt._id, razorpayPaymentId: null },
        { $set: { status: "captured", razorpayPaymentId: p.id, capturedAt: now, verifiedBy: source } },
        { session },
      );
      return "duplicate";
    }

    let outcome: CompletionResult;
    const lines = heldLines(order);
    if (order.status === "pending_payment" && !order.stockReleased) {
      for (const l of lines) await sellReservedVariant(session, { ...l, orderId: order._id, actor });
      await redeemCouponUse(order._id, session);
      outcome = "paid";
    } else if (await canSellAvailable(session, lines)) {
      // Paid after the hold was released (e.g. a slow bank) and the items are still in stock.
      for (const l of lines) await sellAvailableVariant(session, { ...l, orderId: order._id, actor });
      await reclaimReleasedCouponUse(order._id, session);
      outcome = "late_paid";
    } else {
      outcome = "late_unfulfillable";
    }

    const paid = {
      paymentStatus: "captured",
      razorpayPaymentId: p.id,
      razorpayOrderId: p.order_id,
      paymentGateway: "razorpay",
      paymentMode: attempt.mode,
      paidAt: now,
      paymentLockUntil: null,
      ...(allowedMethod(p.method) ? { paymentMethod: p.method } : {}),
      // A late sale means the order holds units again, so cancelling it must put them back.
      ...(outcome === "late_paid" ? { stockReleased: false } : {}),
    };
    const res = await Order.updateOne(
      { _id: order._id, paymentStatus: { $nin: [...SETTLED_STATUSES] }, razorpayPaymentId: null },
      outcome === "late_unfulfillable"
        ? {
            $set: {
              ...paid,
              exception: {
                code: "PAID_AFTER_EXPIRY",
                message: `Payment ${p.id} was captured after the order's stock was released, and the items are no longer available. Refund the customer or arrange stock.`,
                at: now,
              },
            },
          }
        : {
            $set: { ...paid, status: "placed", placedAt: now },
            $push: { statusHistory: { status: "placed", at: now, by: actor, note: `Payment ${p.id} confirmed (${source})${outcome === "late_paid" ? " after the reservation expired" : ""}` } },
          },
      { session },
    );
    if (res.modifiedCount !== 1) throw new AppError(409, "CONFLICT", "The order changed while confirming the payment. Please retry.");

    await Payment.updateOne(
      { _id: attempt._id },
      {
        $set: {
          status: "captured",
          razorpayPaymentId: p.id,
          method: allowedMethod(p.method) ? p.method : null,
          // Display label only — never card numbers, UPI IDs or bank credentials.
          methodDetail: (p.bank ?? p.card?.network ?? "").toString().slice(0, 100),
          international: !!p.international,
          feePaise: Number.isSafeInteger(p.fee) ? p.fee : 0,
          taxPaise: Number.isSafeInteger(p.tax) ? p.tax : 0,
          capturedAt: now,
          verifiedBy: source,
        },
      },
      { session },
    );
    return outcome;
  });

  logger[result === "paid" || result === "already_paid" ? "info" : "warn"]("payment.completion", { paymentId: p.id, razorpayOrderId: p.order_id, source, result });

  // The payment is on record: apply any refund that arrived before it was (after the commit above).
  if (result !== "unknown_order" && result !== "not_captured" && result !== "mismatch") {
    const refunds = await applyDeferredRefunds(p.id).catch((err: unknown) => {
      logger.error("refund.deferred_lookup_failed", { paymentId: p.id, error: serializeError(err) });
      return { failed: 1 };
    });
    // A failed webhook is redelivered by Razorpay, which tries again. Checkout isn't held up.
    if (refunds.failed && source === "webhook") throw new Error("Saved refunds couldn't be applied yet.");
  }
  return result;
}

/**
 * Records a payment Razorpay reports as failed. The order stays reserved (the customer can try
 * again until the hold ends) — a failed payment never releases stock or touches a paid order.
 */
export async function recordPaymentFailure(p: RazorpayPayment, source: "verify" | "webhook" | "reconcile") {
  await connectToDatabase();
  const attempt = await Payment.findOne({ razorpayOrderId: p.order_id }, { order: 1, status: 1 }).lean<AttemptDoc>();
  if (!attempt) return "unknown_order" as const;
  if (isSettledStatus(attempt.status)) return "ignored" as const; // failure arriving after success
  const res = await Payment.updateOne(
    { _id: attempt._id, status: { $nin: [...SETTLED_STATUSES] }, "failures.razorpayPaymentId": { $ne: p.id } },
    {
      $set: { status: "failed", errorCode: p.error_code ?? null, errorDescription: p.error_description?.slice(0, 500) ?? null },
      $push: {
        failures: {
          razorpayPaymentId: p.id,
          code: p.error_code ?? null,
          description: p.error_description?.slice(0, 500) ?? null,
          reason: p.error_reason ?? null,
          method: allowedMethod(p.method) ? p.method : null,
          source,
          at: new Date(),
        },
      },
    },
  );
  if (res.modifiedCount !== 1) return "duplicate" as const;
  await Order.updateOne(
    { _id: attempt.order, status: "pending_payment", paymentStatus: { $in: ["pending", "failed"] }, razorpayOrderId: p.order_id },
    { $set: { paymentStatus: "failed" } },
  );
  return "recorded" as const;
}

/* ---------- Reconciliation with Razorpay (authoritative state) ---------- */

export type GatewayState = "paid" | "processing" | "unpaid" | "unknown";

/**
 * Asks Razorpay about every payment attempt of an order. Captured → completed here; authorized →
 * captured for the stored amount, then completed; still in progress → "processing"; failures are
 * recorded. "unknown" when Razorpay can't be asked (not configured, unreachable).
 */
export async function reconcileOrder(orderId: Types.ObjectId): Promise<GatewayState> {
  await connectToDatabase();
  const attempts = await Payment.find({ order: orderId }).sort({ attempt: -1 }).lean<AttemptDoc[]>();
  if (!attempts.length) return "unpaid";
  if (attempts.some((a) => isSettledStatus(a.status))) return "paid";
  const config = getRazorpayConfig();
  if (!config) return "unknown";
  const order = await Order.findById(orderId).lean<OrderDoc>();
  if (!order) return "unknown";
  if (isSettled(order)) return "paid";

  let processing = false;
  for (const attempt of attempts) {
    let payments: RazorpayPayment[];
    try {
      payments = (await razorpayRequest<{ items: RazorpayPayment[] }>(config, `/orders/${encodeURIComponent(attempt.razorpayOrderId)}/payments`, { timeoutMs: GATEWAY_TIMEOUT_MS })).items ?? [];
    } catch (err) {
      logger.warn("razorpay.reconcile_unreachable", { orderId: String(orderId), error: serializeError(err) });
      return "unknown";
    }
    for (let p of payments) {
      if (p.order_id !== attempt.razorpayOrderId) continue;
      if (p.status === "authorized") p = await captureIfAuthorized(config, p, order, attempt).catch(() => p);
      if (p.status === "captured") {
        const r = await completePayment(p, "reconcile");
        // A captured payment that doesn't match keeps the stock held until staff look at it.
        return r === "mismatch" ? "processing" : "paid";
      }
      if (p.status === "failed") await recordPaymentFailure(p, "reconcile");
      else if (p.status === "created" || p.status === "authorized") processing = true;
    }
  }
  return processing ? "processing" : "unpaid";
}

/**
 * Expiry rule for orders with payment attempts: ask Razorpay first. Paid → never released (it is
 * completed instead). Still processing → kept for a grace period. Razorpay unreachable → kept
 * (up to a long cap). Only definitively unpaid orders are released.
 */
export const paymentAwareExpiryCheck: ExpiryCheck = async (o) => {
  const hasAttempts = (o.paymentAttemptCount ?? 0) > 0 || !!(await Payment.exists({ order: o._id }));
  if (!hasAttempts) return "release";
  const state = await reconcileOrder(o._id);
  const overdue = Date.now() - (o.reservationExpiresAt?.getTime() ?? 0);
  if (state === "unpaid") return "release";
  if (state === "processing") return overdue > PROCESSING_GRACE_MS ? "release" : "keep";
  if (state === "unknown") return overdue > UNREACHABLE_RELEASE_MS ? "release" : "keep";
  return "keep"; // paid — completed by reconcileOrder
};

/** The expiry sweep used by checkout and the cron endpoint. */
export function expireUnpaidOrders(opts: { limit?: number; now?: Date; deadline?: number } = {}) {
  return expireStaleOrders({ ...opts, check: paymentAwareExpiryCheck });
}

/* ---------- Starting / retrying a payment ---------- */

function assertPayable(order: OrderDoc, now = Date.now()) {
  if (order.paymentStatus === "captured") throw new AppError(409, "ALREADY_PAID", "This order is already paid.");
  if (order.status !== "pending_payment" || order.stockReleased) {
    throw new AppError(
      409,
      "ORDER_EXPIRED",
      order.status === "cancelled"
        ? "This order was cancelled. Please place a new order."
        : "This order has expired and its items were released. Please place a new order to buy them.",
    );
  }
  const left = (order.reservationExpiresAt?.getTime() ?? 0) - now;
  if (left < MIN_TIME_LEFT_MS) throw new AppError(409, "ORDER_EXPIRED", "The time to pay for this order has run out. Please place a new order.");
}

function toStart(order: OrderDoc, attempt: AttemptDoc, config: RazorpayConfig): PaymentStart {
  const expires = order.reservationExpiresAt!;
  return {
    keyId: config.keyId,
    mode: config.mode,
    razorpayOrderId: attempt.razorpayOrderId,
    amountPaise: attempt.amountPaise,
    currency: "INR",
    orderId: order.orderNumber,
    attempt: attempt.attempt,
    reservedUntil: expires.toISOString(),
    // Razorpay Checkout closes itself before the hold ends.
    timeoutSeconds: Math.max(60, Math.floor((expires.getTime() - Date.now()) / 1000) - 30),
    prefill: { name: order.customer.fullName, email: order.customer.email, contact: `+91${order.customer.mobile}` },
  };
}

const latestAttempt = (orderId: Types.ObjectId) => Payment.findOne({ order: orderId }).sort({ attempt: -1 }).lean<AttemptDoc>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Gives Razorpay Checkout what it needs to pay an order — for the stored order total only.
 *
 * - `retry: false` (first "Pay"): reuses the current attempt if it isn't paid, so double clicks
 *   and page reloads never create extra Razorpay orders.
 * - `retry: true`: checks with Razorpay first — already paid → 409 ALREADY_PAID; a payment still
 *   in progress → 409 PAYMENT_IN_PROGRESS; otherwise a new attempt (new Razorpay order, same store
 *   order, same total, no new stock reservation).
 *
 * Creating an attempt takes a short lock on the order, so simultaneous requests can't create two.
 */
export async function startPayment(orderNumber: string, viewer: OrderViewer, { retry }: { retry: boolean }): Promise<PaymentStart> {
  const config = razorpayConfig(); // 503 (names of missing variables logged) if not configured
  await connectToDatabase();
  let order = await loadOrderForViewer(orderNumber, viewer);
  assertPayable(order);

  const latest = await latestAttempt(order._id);
  if (latest && latest.status !== "captured" && latest.amountPaise === order.totalPaise && latest.mode === config.mode) {
    if (!retry) return toStart(order, latest, config);
    const state = await reconcileOrder(order._id);
    if (state === "paid") throw new AppError(409, "ALREADY_PAID", "This order has been paid.");
    if (state === "processing") {
      throw new AppError(409, "PAYMENT_IN_PROGRESS", "Your previous payment is still being processed. Please wait a few minutes before trying again.");
    }
    if (state === "unknown") throw new AppError(503, "SERVICE_UNAVAILABLE", "We couldn't check your previous payment. Please try again shortly.");
    order = await loadOrderForViewer(orderNumber, viewer);
    assertPayable(order);
  }

  const attemptNo = Math.max(order.paymentAttemptCount ?? 0, latest?.attempt ?? 0) + 1;
  if (attemptNo > MAX_ATTEMPTS) throw new AppError(409, "CONFLICT", "Too many payment attempts for this order. Please place a new order.");

  const now = new Date();
  const claimed = await Order.findOneAndUpdate(
    {
      _id: order._id,
      status: "pending_payment",
      stockReleased: false,
      paymentStatus: { $ne: "captured" },
      $or: [{ paymentLockUntil: null }, { paymentLockUntil: { $lte: now } }],
    },
    { $set: { paymentLockUntil: new Date(now.getTime() + LOCK_MS) } },
    { returnDocument: "after", projection: { _id: 1 } },
  ).lean();
  if (!claimed) {
    // Another request is creating the attempt right now (double click): hand back its result.
    if (!retry) {
      for (let i = 0; i < 20; i++) {
        await sleep(250);
        const a = await latestAttempt(order._id);
        if (a && a.attempt > (latest?.attempt ?? 0)) return toStart(order, a, config);
      }
    }
    throw new AppError(409, "PAYMENT_IN_PROGRESS", "A payment is already being started for this order. Please wait a moment and try again.");
  }

  try {
    const rp = await gateway("create order", () =>
      razorpayRequest<RazorpayOrder>(config, "/orders", {
        method: "POST",
        body: {
          amount: order.totalPaise,
          currency: "INR",
          receipt: `${order.orderNumber}-${attemptNo}`,
          notes: { store_order_id: order.orderNumber, attempt: String(attemptNo) },
        },
      }),
    );
    if (rp.amount !== order.totalPaise || rp.currency !== "INR") {
      logger.error("razorpay.order_mismatch", { orderNumber: order.orderNumber, amount: rp.amount, currency: rp.currency });
      throw new AppError(502, "SERVICE_UNAVAILABLE", "We couldn't start the payment. Please try again.");
    }
    const [doc] = await Payment.create([
      {
        order: order._id,
        orderNumber: order.orderNumber,
        user: order.user ?? null,
        attempt: attemptNo,
        mode: config.mode,
        razorpayOrderId: rp.id,
        amountPaise: order.totalPaise,
        currency: "INR",
        status: "created",
      },
    ]);
    await Order.updateOne(
      { _id: order._id, status: "pending_payment" },
      { $set: { razorpayOrderId: rp.id, paymentGateway: "razorpay", paymentAttemptCount: attemptNo, paymentLockUntil: null, ...(order.paymentStatus === "failed" ? { paymentStatus: "pending" } : {}) } },
    );
    logger.info("payment.attempt_created", { orderNumber: order.orderNumber, attempt: attemptNo, mode: config.mode });
    return toStart(order, doc.toObject() as unknown as AttemptDoc, config);
  } finally {
    await Order.updateOne({ _id: order._id, paymentLockUntil: { $ne: null } }, { $set: { paymentLockUntil: null } }).catch(() => undefined);
  }
}

/* ---------- Checkout callback ---------- */

export interface CheckoutCallback {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

/**
 * The browser's "payment succeeded" callback. Treated as a claim, not proof: the Razorpay order
 * must be one of this store order's attempts, the signature must verify with our secret, and the
 * payment is re-read from Razorpay (its order, amount, currency and status) before anything changes.
 */
export async function verifyCheckoutPayment(orderNumber: string, viewer: OrderViewer, cb: CheckoutCallback) {
  const config = razorpayConfig();
  await connectToDatabase();
  const order = await loadOrderForViewer(orderNumber, viewer);
  const attempt = await Payment.findOne({ order: order._id, razorpayOrderId: cb.razorpay_order_id }).lean<AttemptDoc>();
  if (!attempt) throw new AppError(400, "PAYMENT_INVALID", "This payment doesn't belong to this order.");
  if (!verifyPaymentSignature(cb.razorpay_order_id, cb.razorpay_payment_id, cb.razorpay_signature, config.keySecret)) {
    logger.warn("payment.signature_invalid", { orderNumber, razorpayOrderId: cb.razorpay_order_id });
    throw new AppError(400, "PAYMENT_INVALID", "We couldn't verify this payment. If money was deducted, it will be confirmed automatically or refunded.");
  }

  let p = await gateway("fetch payment", () => razorpayRequest<RazorpayPayment>(config, `/payments/${encodeURIComponent(cb.razorpay_payment_id)}`));
  if (p.order_id !== cb.razorpay_order_id) {
    logger.warn("payment.order_mismatch", { orderNumber, razorpayOrderId: cb.razorpay_order_id });
    throw new AppError(400, "PAYMENT_INVALID", "This payment doesn't belong to this order.");
  }
  if (p.status === "authorized") p = await gateway("capture payment", () => captureIfAuthorized(config, p, order, attempt));

  let result: "paid" | "processing" | "failed";
  const outcome = p.status === "captured" || p.status === "refunded" ? await completePayment(p, "verify") : "not_captured";
  if (outcome !== "not_captured") {
    if (outcome === "mismatch") {
      throw new AppError(400, "PAYMENT_INVALID", `We couldn't match this payment to your order. Please contact us with payment ID ${p.id} — it will be refunded if needed.`);
    }
    result = "paid";
  } else if (p.status === "failed") {
    await recordPaymentFailure(p, "verify");
    result = "failed";
  } else {
    result = "processing";
  }
  const fresh = await loadOrderForViewer(orderNumber, viewer);
  return { result, order: toOrderView(fresh) };
}

/* ---------- Status ---------- */

export async function getPaymentStatus(orderNumber: string, viewer: OrderViewer, { refresh }: { refresh: boolean }): Promise<PaymentStatusView> {
  await connectToDatabase();
  let order = await loadOrderForViewer(orderNumber, viewer);
  if (refresh && order.status === "pending_payment" && order.paymentStatus !== "captured") {
    // e.g. after the customer closed Checkout or lost connection: ask Razorpay what really happened.
    await reconcileOrder(order._id).catch((err) => logger.warn("payment.status_refresh_failed", { error: serializeError(err) }));
    order = await loadOrderForViewer(orderNumber, viewer);
  }
  const attempts = await Payment.find({ order: order._id }).sort({ attempt: 1 }).lean<AttemptDoc[]>();
  const view = toOrderView(order);
  let canPay = true;
  try {
    assertPayable(order);
  } catch {
    canPay = false;
  }
  return {
    orderId: order.orderNumber,
    status: view.status,
    paymentState: paymentStateOf(order),
    reservedUntil: view.reservedUntil ?? null,
    canPay,
    attempts: attempts.map((a) => ({
      attempt: a.attempt,
      status: a.status,
      createdAt: new Date(a.createdAt).toISOString(),
      failure: a.status === "captured" ? null : (a.errorDescription ?? null),
    })),
  };
}

/* ---------- Webhooks ---------- */

interface WebhookBody {
  event?: string;
  payload?: { payment?: { entity?: RazorpayPayment }; order?: { entity?: RazorpayOrder }; refund?: { entity?: RazorpayRefund } };
}

const HANDLED = new Set(["payment.captured", "payment.authorized", "payment.failed", "order.paid"]);
const REFUND_EVENTS = new Set(["refund.created", "refund.processed", "refund.failed"]);

/**
 * Razorpay webhook. The signature is checked over the raw body before anything is parsed or
 * trusted. Each event is recorded by its ID (X-Razorpay-Event-Id): a redelivered event that was
 * already processed is acknowledged without doing anything; one that failed earlier, or a refund
 * still waiting for its payment ("deferred"), is processed again. Events can arrive in any order — completion and failure handling are both idempotent and
 * a failure never overrides a captured payment.
 */
export async function handleWebhook(rawBody: string, signature: string | null, eventIdHeader: string | null) {
  const secret = webhookSecret();
  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    logger.warn("webhook.signature_invalid", {});
    throw badRequest("Invalid signature.");
  }
  let body: WebhookBody;
  try {
    body = JSON.parse(rawBody) as WebhookBody;
  } catch {
    throw badRequest("Invalid payload.");
  }
  const type = typeof body.event === "string" ? body.event.slice(0, 100) : "unknown";
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");
  const eventId = eventIdHeader && /^[A-Za-z0-9_.-]{1,100}$/.test(eventIdHeader) ? eventIdHeader : `sha256:${payloadHash}`;
  const payment = body.payload?.payment?.entity;
  const refund = body.payload?.refund?.entity;
  // Saved with the claim, so a refund is never lost if its payment isn't on record yet.
  const storedRefund = REFUND_EVENTS.has(type) ? toStoredRefund(refund) : null;
  await connectToDatabase();

  // Claim the event (the unique index makes this atomic).
  let eventDoc: { _id: Types.ObjectId } | null = null;
  try {
    eventDoc = await WebhookEvent.create({
      provider: "razorpay",
      eventId,
      type,
      payloadHash,
      razorpayOrderId: typeof payment?.order_id === "string" ? payment.order_id : null,
      razorpayPaymentId: typeof payment?.id === "string" ? payment.id : (storedRefund?.paymentId ?? null),
      refund: storedRefund,
      status: "processing",
    });
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
    const existing = await WebhookEvent.findOne({ provider: "razorpay", eventId }).lean();
    if (!existing) throw err;
    const stale = existing.status === "processing" && Date.now() - new Date(existing.updatedAt as Date).getTime() > STALE_EVENT_MS;
    if (existing.status !== "failed" && existing.status !== "deferred" && !stale) return { duplicate: true, status: existing.status };
    eventDoc = await WebhookEvent.findOneAndUpdate(
      { _id: existing._id, status: existing.status, updatedAt: existing.updatedAt },
      { $set: { status: "processing", error: null, ...(storedRefund && !existing.refund ? { refund: storedRefund } : {}) }, $inc: { attempts: 1 } },
      { returnDocument: "after", projection: { _id: 1 } },
    ).lean();
    if (!eventDoc) return { duplicate: true, status: "processing" };
  }

  try {
    let outcome: string;
    if (REFUND_EVENTS.has(type)) {
      outcome = refund && typeof refund.id === "string" && typeof refund.payment_id === "string" ? await applyRefundWebhook(refund) : "ignored";
      if (outcome === "unknown_payment") outcome = storedRefund ? "deferred" : "ignored";
    } else if (!HANDLED.has(type)) outcome = "ignored";
    else if (!payment || typeof payment.id !== "string" || typeof payment.order_id !== "string") outcome = "ignored";
    else if (type === "payment.failed") outcome = await recordPaymentFailure(payment, "webhook");
    else {
      let p = payment;
      if (p.status === "authorized") {
        const config = razorpayConfig();
        const attempt = await Payment.findOne({ razorpayOrderId: p.order_id }).lean<AttemptDoc>();
        const order = attempt ? await Order.findById(attempt.order).lean<OrderDoc>() : null;
        if (attempt && order) p = await captureIfAuthorized(config, p, order, attempt);
      }
      outcome = await completePayment(p, "webhook");
    }
    if (outcome === "deferred") {
      // Unless the payment was recorded meanwhile and has already applied this refund.
      await WebhookEvent.updateOne({ _id: eventDoc!._id, status: "processing" }, { $set: { status: "deferred" } });
      return { duplicate: false, status: outcome };
    }
    const order = payment?.order_id ? await Payment.findOne({ razorpayOrderId: payment.order_id }, { order: 1 }).lean() : null;
    await WebhookEvent.updateOne(
      { _id: eventDoc!._id },
      { $set: { status: outcome === "ignored" || outcome === "unknown_order" ? "ignored" : "processed", processedAt: new Date(), order: order?.order ?? null } },
    );
    return { duplicate: false, status: outcome };
  } catch (err) {
    await WebhookEvent.updateOne({ _id: eventDoc!._id, status: { $ne: "processed" } }, { $set: { status: "failed", error: (err as Error).message?.slice(0, 1000) ?? "error" } }).catch(() => undefined);
    throw err; // → 5xx, so Razorpay delivers the event again
  }
}
