import type { Coupon } from "@/types";

export const coupons: Coupon[] = [
  {
    code: "WELCOME10",
    type: "percent",
    value: 10,
    minOrder: 0,
    maxDiscount: 400,
    description: "10% off your order (up to ₹400)",
  },
  {
    code: "FIRSTORDER",
    type: "flat",
    value: 100,
    minOrder: 799,
    description: "Flat ₹100 off on orders above ₹799",
  },
  {
    code: "SAVE15",
    type: "percent",
    value: 15,
    minOrder: 1999,
    maxDiscount: 750,
    description: "15% off on orders above ₹1,999 (up to ₹750)",
  },
  {
    code: "FREESHIP",
    type: "freeship",
    value: 0,
    minOrder: 0,
    description: "Free delivery on any order",
  },
  {
    code: "FESTIVE20",
    type: "percent",
    value: 20,
    minOrder: 2999,
    maxDiscount: 1000,
    description: "20% off on orders above ₹2,999 (up to ₹1,000)",
  },
];

export function findCoupon(code: string) {
  const normalized = code.trim().toUpperCase();
  return coupons.find((c) => c.code === normalized);
}
