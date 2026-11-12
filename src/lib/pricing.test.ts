import { describe, expect, it } from "vitest";
import { calculateTotals, couponDiscount, validateCoupon } from "./pricing";
import { findCoupon } from "@/data/coupons";

const line = (price: number, quantity = 1, originalPrice = price) => ({ price, quantity, originalPrice });

describe("calculateTotals — shipping placeholder", () => {
  it("never calculates or adds a shipping charge", () => {
    for (const lines of [[line(499)], [line(1299, 2)], [line(5999), line(349, 3)]]) {
      const t = calculateTotals(lines, null);
      expect(t.shipping).toBeNull();
      expect(t.total).toBe(t.subtotal);
    }
  });

  it("adds no ₹79 (or any) fee to small orders", () => {
    const t = calculateTotals([line(349)], null);
    expect(t.total).toBe(349);
  });

  it("total = subtotal − coupon discount", () => {
    const t = calculateTotals([line(1500, 2, 2000)], "WELCOME10");
    expect(t.subtotal).toBe(3000);
    expect(t.mrpTotal).toBe(4000);
    expect(t.couponDiscount).toBe(300);
    expect(t.total).toBe(2700);
    expect(t.savings).toBe(1000 + 300);
  });

  it("ignores a coupon below its minimum order", () => {
    const t = calculateTotals([line(500)], "SAVE15");
    expect(t.couponDiscount).toBe(0);
    expect(t.total).toBe(500);
  });

  it("empty bag", () => {
    const t = calculateTotals([], null);
    expect(t).toMatchObject({ itemCount: 0, subtotal: 0, total: 0, shipping: null });
  });
});

describe("coupons", () => {
  it("caps percentage discounts", () => {
    expect(couponDiscount(findCoupon("WELCOME10"), 10000)).toBe(400);
  });
  it("validates codes and minimum order", () => {
    expect(validateCoupon("nope", 1000).ok).toBe(false);
    expect(validateCoupon("firstorder", 799).ok).toBe(true);
    expect(validateCoupon("FIRSTORDER", 798).ok).toBe(false);
  });
  it("FREESHIP no longer exists", () => {
    expect(findCoupon("FREESHIP")).toBeUndefined();
  });
});
