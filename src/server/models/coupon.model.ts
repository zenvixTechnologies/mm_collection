import "server-only";
import { Schema, type HydratedDocument } from "mongoose";
import { baseOptions, defineModel, paise } from "./_shared";

/**
 * Discount code. `value` is a percentage (1–100) for "percent" coupons and paise for "flat" ones.
 * `usageCount` is incremented atomically with a `usageCount < usageLimit` guard, so concurrent
 * checkouts can't over-redeem.
 */
const CouponSchema = new Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true, match: /^[A-Z0-9_-]{3,40}$/ },
    description: { type: String, trim: true, maxlength: 200, default: "" },
    type: { type: String, enum: ["percent", "flat"], required: true },
    value: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    minOrderPaise: { ...paise(false), default: 0 },
    maxDiscountPaise: { ...paise(false), default: null },
    startsAt: { type: Date, default: () => new Date() },
    endsAt: { type: Date, default: null },
    /** null = unlimited */
    usageLimit: { type: Number, min: 1, default: null },
    perCustomerLimit: { type: Number, min: 1, default: null },
    usageCount: { type: Number, min: 0, default: 0 },
    active: { type: Boolean, default: true },
    /** Empty = whole catalogue. */
    categories: { type: [{ type: Schema.Types.ObjectId, ref: "Category" }], default: [] },
    products: { type: [{ type: Schema.Types.ObjectId, ref: "Product" }], default: [] },
  },
  baseOptions,
);

CouponSchema.pre("validate", function (this: HydratedDocument<{ type: string; value: number; startsAt?: Date | null; endsAt?: Date | null }>) {
  if (this.type === "percent" && this.value > 100) this.invalidate("value", "Percentage cannot exceed 100");
  if (this.endsAt && this.startsAt && this.endsAt <= this.startsAt) this.invalidate("endsAt", "End date must be after start date");
});

CouponSchema.index({ code: 1 }, { unique: true });
CouponSchema.index({ active: 1, startsAt: 1, endsAt: 1 });

export const Coupon = defineModel("Coupon", CouponSchema, "coupons");
