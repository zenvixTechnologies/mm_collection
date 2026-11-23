import "server-only";
import { Schema } from "mongoose";
import { baseOptions, defineModel, paise } from "./_shared";

/**
 * One use of a coupon by one order. "reserved" while payment is pending, "redeemed" once paid,
 * "released" if the order expires or fails. Per-customer limits count by user and by email
 * (guests).
 */
const CouponRedemptionSchema = new Schema(
  {
    coupon: { type: Schema.Types.ObjectId, ref: "Coupon", required: true },
    code: { type: String, required: true, uppercase: true },
    order: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    email: { type: String, required: true, lowercase: true, trim: true },
    discountPaise: paise(),
    status: { type: String, enum: ["reserved", "redeemed", "released"], default: "reserved" },
  },
  baseOptions,
);

CouponRedemptionSchema.index({ order: 1 }, { unique: true });
CouponRedemptionSchema.index({ coupon: 1, user: 1, status: 1 });
CouponRedemptionSchema.index({ coupon: 1, email: 1, status: 1 });

export const CouponRedemption = defineModel("CouponRedemption", CouponRedemptionSchema, "coupon_redemptions");
