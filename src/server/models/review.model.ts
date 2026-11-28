import "server-only";
import { Schema } from "mongoose";
import { baseOptions, defineModel } from "./_shared";

/**
 * Product review from a verified buyer. One review per customer per product. Only the review
 * service creates these, after checking the order and payment records; they are published at once.
 * Admins can delete a review but never edit one.
 */
const ReviewSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    /** The paid order and payment that proved the purchase when the review was submitted. */
    order: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    payment: { type: Schema.Types.ObjectId, ref: "Payment", default: null },
    variantSku: { type: String, uppercase: true, default: null },
    /** Display name, e.g. "Asha K." */
    authorName: { type: String, required: true, trim: true, maxlength: 80 },
    rating: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },
    title: { type: String, trim: true, maxlength: 120, default: "" },
    comment: { type: String, required: true, trim: true, minlength: 10, maxlength: 2000 },
    /** Photos the server checked and copied itself. Absent on reviews written before photos. */
    images: {
      type: [new Schema({ publicId: { type: String, required: true }, url: { type: String, required: true }, width: Number, height: Number }, { _id: false })],
      default: [],
      validate: { validator: (v: unknown[]) => v.length <= 3, message: "A review has at most 3 photos" },
    },
    /**
     * Set by the server when it verified the purchase. A record without it is unsupported: it is
     * never shown to shoppers or counted in a rating.
     */
    verifiedAt: { type: Date, default: null },
  },
  baseOptions,
);

ReviewSchema.index({ user: 1, product: 1 }, { unique: true });
ReviewSchema.index({ product: 1, createdAt: -1 });
ReviewSchema.index({ createdAt: -1 });

export const Review = defineModel("Review", ReviewSchema, "reviews");
