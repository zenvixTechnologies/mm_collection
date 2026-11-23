import "server-only";
import { Schema } from "mongoose";
import { baseOptions, defineModel } from "./_shared";

/**
 * Every incoming webhook, keyed by the provider's event ID. The unique index makes processing
 * idempotent: a redelivered event hits the duplicate key and is skipped. Kept for 90 days.
 */
const WebhookEventSchema = new Schema(
  {
    provider: { type: String, enum: ["razorpay"], required: true },
    eventId: { type: String, required: true },
    type: { type: String, required: true },
    status: { type: String, enum: ["processing", "processed", "ignored", "failed"], default: "processing" },
    attempts: { type: Number, default: 1 },
    /** SHA-256 of the raw body — enough to detect tampering without storing customer data. */
    payloadHash: { type: String, required: true },
    razorpayOrderId: { type: String, default: null },
    razorpayPaymentId: { type: String, default: null },
    order: { type: Schema.Types.ObjectId, ref: "Order", default: null },
    error: { type: String, maxlength: 1000, default: null },
    processedAt: { type: Date, default: null },
  },
  baseOptions,
);

WebhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
WebhookEventSchema.index({ status: 1, createdAt: -1 });
WebhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const WebhookEvent = defineModel("WebhookEvent", WebhookEventSchema, "webhook_events");
