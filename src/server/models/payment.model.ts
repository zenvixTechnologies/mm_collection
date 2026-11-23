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
  },
  { _id: false, timestamps: true },
);

/** One Razorpay payment attempt. Card/UPI details are never stored — only Razorpay's references. */
const PaymentSchema = new Schema(
  {
    order: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    orderNumber: { type: String, required: true },
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
    errorCode: { type: String, default: null },
    errorDescription: { type: String, maxlength: 500, default: null },
    authorizedAt: { type: Date, default: null },
    capturedAt: { type: Date, default: null },
  },
  baseOptions,
);

PaymentSchema.index({ razorpayPaymentId: 1 }, { unique: true, partialFilterExpression: { razorpayPaymentId: { $type: "string" } } });
PaymentSchema.index({ razorpayOrderId: 1 });
PaymentSchema.index({ order: 1 });
PaymentSchema.index({ "refunds.razorpayRefundId": 1 });
PaymentSchema.index({ status: 1, createdAt: -1 });
PaymentSchema.index({ createdAt: -1 });

export const Payment = defineModel("Payment", PaymentSchema, "payments");
