import "server-only";
import { Schema } from "mongoose";
import { baseOptions, defineModel, paise } from "./_shared";
import { PAYMENT_STATUSES } from "./order.model";

const RefundSchema = new Schema(
  {
    razorpayRefundId: { type: String, required: true },
    amountPaise: paise(),
    status: { type: String, enum: ["pending", "processed", "failed"], default: "pending" },
    reason: { type: String, maxlength: 300 },
    initiatedBy: { type: Schema.Types.ObjectId, ref: "Admin", default: null },
    processedAt: { type: Date, default: null },
    /** Admin request key (also sent to Razorpay in the refund notes) — the same key never refunds twice. */
    idempotencyKey: { type: String, default: null },
    /** How we learned about it: our API call, a verified webhook, or a status sync with Razorpay. */
    source: { type: String, enum: ["admin", "webhook", "sync"], default: "admin" },
  },
  { _id: false, timestamps: true },
);

/** A payment Razorpay reported as failed on this attempt (the customer may then try again). */
const FailureSchema = new Schema(
  {
    razorpayPaymentId: { type: String, required: true },
    code: { type: String, maxlength: 100, default: null },
    /** Razorpay's customer-safe description. */
    description: { type: String, maxlength: 500, default: null },
    reason: { type: String, maxlength: 100, default: null },
    method: { type: String, maxlength: 30, default: null },
    source: { type: String, enum: ["verify", "webhook", "reconcile"], required: true },
    at: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

/**
 * One payment attempt = one Razorpay order created for a store order (a retry creates attempt
 * n+1; the store order and its stock reservation stay the same). Within one attempt the customer
 * may try several payments in the Razorpay window: failures are listed in `failures`; the one that
 * succeeds is `razorpayPaymentId`. Card/UPI/bank details are never stored — only Razorpay's IDs and
 * a display label (bank or card network).
 */
const PaymentSchema = new Schema(
  {
    order: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    orderNumber: { type: String, required: true },
    attempt: { type: Number, min: 1, default: 1 },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    provider: { type: String, enum: ["razorpay"], default: "razorpay" },
    mode: { type: String, enum: ["test", "live"], required: true },
    razorpayOrderId: { type: String, required: true },
    razorpayPaymentId: { type: String, default: null },
    amountPaise: paise(),
    currency: { type: String, enum: ["INR"], default: "INR" },
    status: { type: String, enum: ["created", ...PAYMENT_STATUSES], default: "created" },
    method: { type: String, enum: ["upi", "card", "netbanking", null], default: null },
    /** Bank / card network / UPI app, display only. */
    methodDetail: { type: String, maxlength: 100, default: "" },
    international: { type: Boolean, default: false },
    feePaise: { ...paise(false), default: 0 },
    taxPaise: { ...paise(false), default: 0 },
    refundedPaise: { ...paise(false), default: 0 },
    refunds: { type: [RefundSchema], default: [] },
    /** Short lock while a refund is being created, so two refunds can't run at once. */
    refundLockUntil: { type: Date, default: null },
    errorCode: { type: String, default: null },
    errorDescription: { type: String, maxlength: 500, default: null },
    failures: { type: [FailureSchema], default: [] },
    /** How the success was confirmed: checkout callback (signature verified), webhook or reconciliation. */
    verifiedBy: { type: String, enum: ["verify", "webhook", "reconcile", null], default: null },
    authorizedAt: { type: Date, default: null },
    capturedAt: { type: Date, default: null },
  },
  baseOptions,
);

PaymentSchema.index({ razorpayPaymentId: 1 }, { unique: true, partialFilterExpression: { razorpayPaymentId: { $type: "string" } } });
PaymentSchema.index({ razorpayOrderId: 1 }, { unique: true });
PaymentSchema.index({ order: 1, attempt: 1 }, { unique: true });
PaymentSchema.index({ "refunds.razorpayRefundId": 1 });
PaymentSchema.index({ status: 1, createdAt: -1 });
PaymentSchema.index({ createdAt: -1 });

export const Payment = defineModel("Payment", PaymentSchema, "payments");
