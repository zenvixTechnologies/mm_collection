import type { CartTotals, Coupon } from "@/types";
import { findCoupon } from "@/data/coupons";
import { FREE_SHIPPING_THRESHOLD, SHIPPING_FEE, formatPrice } from "./utils";

interface PriceLine {
  price: number;
  originalPrice?: number;
  quantity: number;
}

export type CouponCheck = { ok: true; coupon: Coupon } | { ok: false; error: string };

/** Validate a coupon code against the current subtotal. */
export function validateCoupon(code: string, subtotal: number): CouponCheck {
  if (!code.trim()) return { ok: false, error: "Please enter a coupon code." };
  const coupon = findCoupon(code);
  if (!coupon) return { ok: false, error: `"${code.trim().toUpperCase()}" is not a valid coupon code.` };
  if (subtotal < coupon.minOrder) {
    return {
      ok: false,
      error: `${coupon.code} needs a minimum order of ${formatPrice(coupon.minOrder)}. Add ${formatPrice(
        coupon.minOrder - subtotal,
      )} more to use it.`,
    };
  }
  return { ok: true, coupon };
}

export function couponDiscount(coupon: Coupon | undefined, subtotal: number) {
  if (!coupon || subtotal < coupon.minOrder) return 0;
  if (coupon.type === "flat") return Math.min(coupon.value, subtotal);
  if (coupon.type === "percent") {
    const raw = Math.round((subtotal * coupon.value) / 100);
    return coupon.maxDiscount ? Math.min(raw, coupon.maxDiscount) : raw;
  }
  return 0;
}

export function calculateTotals(lines: PriceLine[], couponCode: string | null): CartTotals {
  const itemCount = lines.reduce((n, l) => n + l.quantity, 0);
  const subtotal = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const mrpTotal = lines.reduce((sum, l) => sum + (l.originalPrice ?? l.price) * l.quantity, 0);

  const coupon = couponCode ? findCoupon(couponCode) : undefined;
  const validCoupon = coupon && subtotal >= coupon.minOrder ? coupon : undefined;
  const discount = couponDiscount(validCoupon, subtotal);

  const freeShipping =
    itemCount === 0 || subtotal >= FREE_SHIPPING_THRESHOLD || validCoupon?.type === "freeship";
  const shipping = freeShipping ? 0 : SHIPPING_FEE;

  const total = Math.max(0, subtotal - discount + shipping);
  return {
    itemCount,
    subtotal,
    mrpTotal,
    couponDiscount: discount,
    shipping,
    total,
    savings: mrpTotal - subtotal + discount,
  };
}
