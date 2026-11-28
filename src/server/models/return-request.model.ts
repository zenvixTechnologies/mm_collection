import "server-only";
import { Schema } from "mongoose";
import { RETURN_REASON_KEYS, RETURN_STATUS_KEYS } from "@/lib/after-sales";
import { ActorSchema, baseOptions, defineModel } from "./_shared";

/**
 * A customer's request to return one line of a delivered order. It is a record only: creating or
 * updating it never moves money or stock — refunds go through the Razorpay refund workflow and
 * returned stock is booked in Inventory by staff. Never deleted.
 */
const ReturnRequestSchema = new Schema(
  {
    order: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    orderNumber: { type: String, required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    /** The order line being returned, with what it was at the time. */
    itemId: { type: Schema.Types.ObjectId, required: true },
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    variantSku: { type: String, required: true, uppercase: true },
    name: { type: String, required: true },
    size: { type: String, default: null },
    color: { type: String, default: null },
    unitPricePaise: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1, max: 20, validate: Number.isInteger },
    reason: { type: String, enum: RETURN_REASON_KEYS, required: true },
    explanation: { type: String, trim: true, maxlength: 1000, default: "" },
    comments: { type: String, trim: true, maxlength: 1000, default: "" },
    deliveredAt: { type: Date, required: true },
    /** For damaged/wrong-item reasons: whether it arrived within the policy's 48 hours. */
    withinClaimWindow: { type: Boolean, default: null },
    status: { type: String, enum: RETURN_STATUS_KEYS, default: "requested" },
    /** Append-only: the request and every status change. */
    history: {
      type: [new Schema({ status: { type: String, enum: RETURN_STATUS_KEYS, required: true }, at: { type: Date, required: true }, by: ActorSchema }, { _id: false })],
      default: [],
    },
    /** Staff only — never included in anything a customer receives. */
    adminNotes: {
      type: [new Schema({ author: ActorSchema, text: { type: String, maxlength: 2000 }, at: { type: Date, required: true } }, { _id: true })],
      default: [],
    },
  },
  baseOptions,
);

ReturnRequestSchema.index({ order: 1, itemId: 1 });
ReturnRequestSchema.index({ status: 1, createdAt: -1 });
ReturnRequestSchema.index({ createdAt: -1 });

export const ReturnRequest = defineModel("ReturnRequest", ReturnRequestSchema, "return_requests");
