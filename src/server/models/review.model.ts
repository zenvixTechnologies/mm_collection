import "server-only";
import { Schema } from "mongoose";
import { baseOptions, defineModel } from "./_shared";

/**
 * Product review from a verified buyer. Every review starts "pending" and is shown publicly only
 * after an admin approves it. One review per product per order.
 */
const ReviewSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    order: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    variantSku: { type: String, uppercase: true, default: null },
    /** Display name, e.g. "Asha K." */
    authorName: { type: String, required: true, trim: true, maxlength: 80 },
    location: { type: String, trim: true, maxlength: 80, default: "" },
    rating: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },
    title: { type: String, trim: true, maxlength: 120, default: "" },
    comment: { type: String, required: true, trim: true, minlength: 10, maxlength: 2000 },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    moderatedBy: { type: Schema.Types.ObjectId, ref: "Admin", default: null },
    moderatedAt: { type: Date, default: null },
    rejectionReason: { type: String, maxlength: 300, default: null },
  },
  baseOptions,
);

ReviewSchema.index({ order: 1, product: 1 }, { unique: true });
ReviewSchema.index({ product: 1, status: 1, createdAt: -1 });
ReviewSchema.index({ status: 1, createdAt: -1 });
ReviewSchema.index({ user: 1, createdAt: -1 });

export const Review = defineModel("Review", ReviewSchema, "reviews");
