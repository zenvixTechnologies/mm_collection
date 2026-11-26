import "server-only";
import type { ClientSession, Types } from "mongoose";
import type { PublicCoupon } from "@/types";
import { formatPrice } from "@/lib/utils";
import { connectToDatabase } from "@/server/db/connect";
import { Coupon } from "@/server/models/coupon.model";
import { CouponRedemption } from "@/server/models/coupon-redemption.model";

/**
 * Coupons, checked only on the server.
 *
 * Usage limits are race-free: every order that uses a coupon increments `usageCount` with a
 * `usageCount < usageLimit` guard inside the checkout transaction. Because every redemption
 * writes the same coupon document, two simultaneous checkouts with one coupon conflict and one of
 * them is retried on fresh data — so neither the global nor the per-customer limit can be
 * exceeded. A released order (expired/cancelled before payment) gives its use back.
 */

export interface CouponDoc {
  _id: Types.ObjectId;
  code: string;
  description?: string | null;
  type: "percent" | "flat";
  value: number;
  minOrderPaise?: number | null;
  maxDiscountPaise?: number | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  usageLimit?: number | null;
  perCustomerLimit?: number | null;
  usageCount?: number | null;
  active?: boolean | null;
  categories?: Types.ObjectId[];
  products?: Types.ObjectId[];
  excludedCategories?: Types.ObjectId[];
  excludedProducts?: Types.ObjectId[];
}

/** One priced line, as far as coupon eligibility is concerned. */
export interface CouponLine {
  product: Types.ObjectId;
  /** Main category and extra category tags. */
  categories: Types.ObjectId[];
  lineTotalPaise: number;
}

/** Who is using the coupon, for per-customer limits. Guests are counted by email. */
export interface CouponIdentity {
  userId?: string | null;
  email?: string | null;
}

export type CouponEvaluation =
  | { ok: true; coupon: CouponDoc; discountPaise: number; description: string }
  | { ok: false; coupon: CouponDoc | null; message: string; description: string };

const rupees = (paise: number) => formatPrice(paise / 100);

export function describeCoupon(c: Pick<CouponDoc, "description" | "type" | "value" | "minOrderPaise" | "maxDiscountPaise">) {
  if (c.description) return c.description;
  const off = c.type === "percent" ? `${c.value}% off` : `${rupees(c.value)} off`;
  const min = c.minOrderPaise ? ` on orders above ${rupees(c.minOrderPaise)}` : "";
  const cap = c.type === "percent" && c.maxDiscountPaise ? ` (up to ${rupees(c.maxDiscountPaise)})` : "";
  return `${off}${min}${cap}`;
}

/**
 * Discount in paise for an eligible amount. Percentage discounts are rounded down to whole
 * rupees (never more than the advertised percentage) and capped by `maxDiscountPaise`; no
 * discount can exceed the amount it applies to.
 */
export function couponDiscountPaise(c: Pick<CouponDoc, "type" | "value" | "maxDiscountPaise">, eligiblePaise: number) {
  if (eligiblePaise <= 0) return 0;
  let discount =
    c.type === "percent" ? Math.floor((eligiblePaise * Math.min(c.value, 100)) / 100 / 100) * 100 : Math.max(0, Math.floor(c.value));
  if (c.type === "percent" && c.maxDiscountPaise != null) discount = Math.min(discount, c.maxDiscountPaise);
  return Math.min(discount, eligiblePaise);
}

export async function findCouponByCode(code: string, session?: ClientSession) {
  await connectToDatabase();
  return Coupon.findOne({ code: code.trim().toUpperCase() })
    .session(session ?? null)
    .lean<CouponDoc>();
}

/** Uses of this coupon by this customer that still count (held by a pending order, or paid). */
async function usesBy(coupon: CouponDoc, who: CouponIdentity, session?: ClientSession) {
  const or: Record<string, unknown>[] = [];
  if (who.userId) or.push({ user: who.userId });
  if (who.email) or.push({ email: who.email.toLowerCase() });
  if (!or.length) return 0;
  return CouponRedemption.countDocuments({ coupon: coupon._id, status: { $in: ["reserved", "redeemed"] }, $or: or }).session(session ?? null);
}

/**
 * Checks a coupon code against the current lines and works out its discount. Every rule is
 * enforced here: exists, active, within its dates, usage limits, per-customer limit (when we
 * know who is buying), applicable products/categories and minimum order value.
 */
export async function evaluateCoupon(
  code: string,
  lines: CouponLine[],
  who: CouponIdentity,
  { session, now = new Date() }: { session?: ClientSession; now?: Date } = {},
): Promise<CouponEvaluation> {
  const shown = code.trim().toUpperCase();
  const coupon = await findCouponByCode(shown, session);
  if (!coupon) return { ok: false, coupon: null, message: `"${shown}" is not a valid coupon code.`, description: "" };
  const description = describeCoupon(coupon);
  const no = (message: string): CouponEvaluation => ({ ok: false, coupon, message, description });

  if (coupon.active === false) return no(`${coupon.code} is no longer available.`);
  if (coupon.startsAt && coupon.startsAt > now) return no(`${coupon.code} isn't active yet.`);
  if (coupon.endsAt && coupon.endsAt <= now) return no(`${coupon.code} has expired.`);
  if (coupon.usageLimit != null && (coupon.usageCount ?? 0) >= coupon.usageLimit) return no(`${coupon.code} has reached its usage limit.`);
  if (coupon.perCustomerLimit != null && (who.userId || who.email)) {
    if ((await usesBy(coupon, who, session)) >= coupon.perCustomerLimit) {
      return no(coupon.perCustomerLimit === 1 ? `You've already used ${coupon.code}.` : `You've already used ${coupon.code} the maximum number of times.`);
    }
  }

  const products = new Set((coupon.products ?? []).map(String));
  const categories = new Set((coupon.categories ?? []).map(String));
  const excludedProducts = new Set((coupon.excludedProducts ?? []).map(String));
  const excludedCategories = new Set((coupon.excludedCategories ?? []).map(String));
  const restricted = products.size > 0 || categories.size > 0;
  const hasExclusions = excludedProducts.size > 0 || excludedCategories.size > 0;
  const eligiblePaise = lines
    .filter((l) => !restricted || products.has(String(l.product)) || l.categories.some((c) => categories.has(String(c))))
    .filter((l) => !excludedProducts.has(String(l.product)) && !l.categories.some((c) => excludedCategories.has(String(c))))
    .reduce((sum, l) => sum + l.lineTotalPaise, 0);
  if ((restricted || hasExclusions) && eligiblePaise === 0) return no(`${coupon.code} doesn't apply to the items in your order.`);

  const min = coupon.minOrderPaise ?? 0;
  if (eligiblePaise < min) {
    const on = restricted || hasExclusions ? " on eligible items" : "";
    return no(`${coupon.code} needs a minimum order of ${rupees(min)}${on}. Add ${rupees(min - eligiblePaise)} more to use it.`);
  }

  const discountPaise = couponDiscountPaise(coupon, eligiblePaise);
  if (discountPaise <= 0) return no(`${coupon.code} doesn't give a discount on this order.`);
  return { ok: true, coupon, discountPaise, description };
}

/**
 * Takes one use of the coupon (inside the checkout transaction). Returns false when the usage
 * limit was reached in the meantime or the coupon was switched off.
 */
export async function takeCouponUse(couponId: Types.ObjectId, session: ClientSession, now = new Date()) {
  const res = await Coupon.updateOne(
    {
      _id: couponId,
      active: { $ne: false },
      $and: [
        { $or: [{ usageLimit: null }, { $expr: { $lt: ["$usageCount", "$usageLimit"] } }] },
        { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] },
      ],
    },
    { $inc: { usageCount: 1 } },
    { session },
  );
  return res.modifiedCount === 1;
}

/** Gives back the coupon use held by an order that ended unpaid. No-op if it held none. */
export async function releaseCouponUse(orderId: Types.ObjectId, session: ClientSession) {
  const redemption = await CouponRedemption.findOneAndUpdate(
    { order: orderId, status: "reserved" },
    { $set: { status: "released" } },
    { session, projection: { coupon: 1 } },
  ).lean();
  if (!redemption) return false;
  await Coupon.updateOne({ _id: redemption.coupon, usageCount: { $gt: 0 } }, { $inc: { usageCount: -1 } }, { session });
  return true;
}

/** Coupons the storefront may advertise: active, listed, within their dates and not used up. */
export async function listPublicCoupons(now = new Date()): Promise<PublicCoupon[]> {
  await connectToDatabase();
  const docs = await Coupon.find({
    active: true,
    listed: { $ne: false },
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] },
      { $or: [{ usageLimit: null }, { $expr: { $lt: ["$usageCount", "$usageLimit"] } }] },
    ],
  })
    .sort({ minOrderPaise: 1, code: 1 })
    .limit(20)
    .lean<CouponDoc[]>();
  return docs.map((c) => ({
    code: c.code,
    description: describeCoupon(c),
    type: c.type,
    value: c.type === "flat" ? c.value / 100 : c.value,
    minOrder: (c.minOrderPaise ?? 0) / 100,
    maxDiscount: c.maxDiscountPaise != null ? c.maxDiscountPaise / 100 : null,
  }));
}

/** Order paid: its held coupon use becomes final ("redeemed"). */
export async function redeemCouponUse(orderId: Types.ObjectId, session: ClientSession) {
  const res = await CouponRedemption.updateOne({ order: orderId, status: "reserved" }, { $set: { status: "redeemed" } }, { session });
  return res.modifiedCount === 1;
}

/**
 * An order paid after it expired (its coupon use was given back): the customer paid the
 * discounted total, so the use is counted again — without the usage-limit check, as the money is
 * already taken.
 */
export async function reclaimReleasedCouponUse(orderId: Types.ObjectId, session: ClientSession) {
  const redemption = await CouponRedemption.findOneAndUpdate(
    { order: orderId, status: "released" },
    { $set: { status: "redeemed" } },
    { session, projection: { coupon: 1 } },
  ).lean();
  if (!redemption) return false;
  await Coupon.updateOne({ _id: redemption.coupon }, { $inc: { usageCount: 1 } }, { session });
  return true;
}
