import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { products } from "@/data/products";
import { quoteOrder, toPaise } from "./order-quote";
import { checkDomesticPayment, verifyPaymentSignature, type RazorpayOrder, type RazorpayPayment } from "./razorpay/server";
import { parseCheckoutInput, validateCheckout } from "./validation";

const p = products.find((x) => x.stock >= 3 && x.sizes.length && x.colors.length)!;
const line = (over: Record<string, unknown> = {}) => ({
  productId: p.id,
  size: p.sizes[0],
  color: p.colors[0].name,
  quantity: 1,
  ...over,
});

describe("quoteOrder — server-side pricing", () => {
  it("uses catalogue prices and ignores any price sent by the browser", () => {
    const q = quoteOrder([line({ quantity: 2, price: 1, total: 1 })], null);
    expect(q.ok).toBe(true);
    if (q.ok) {
      expect(q.items[0].price).toBe(p.price);
      expect(q.totals.total).toBe(p.price * 2);
      expect(q.totals.shipping).toBeNull();
    }
  });

  it("rejects unknown products, bad variants, bad quantities and over-stock", () => {
    expect(quoteOrder([line({ productId: "nope" })], null).ok).toBe(false);
    expect(quoteOrder([line({ size: "XXXL" })], null).ok).toBe(false);
    expect(quoteOrder([line({ color: "Neon" })], null).ok).toBe(false);
    expect(quoteOrder([line({ quantity: 0 })], null).ok).toBe(false);
    expect(quoteOrder([line({ quantity: 1.5 })], null).ok).toBe(false);
    expect(quoteOrder([line({ quantity: p.stock + 1 })], null).ok).toBe(false);
    expect(quoteOrder([], null).ok).toBe(false);
    expect(quoteOrder("junk", null).ok).toBe(false);
  });

  it("applies valid coupons and drops invalid ones", () => {
    const q = quoteOrder([line()], "welcome10");
    expect(q.ok && q.couponCode).toBe("WELCOME10");
    const bad = quoteOrder([line()], "NOTREAL");
    expect(bad.ok && bad.couponCode).toBeNull();
  });

  it("converts rupees to paise", () => {
    expect(toPaise(1299)).toBe(129900);
  });
});

describe("Razorpay verification", () => {
  const secret = "test_secret";
  const sig = createHmac("sha256", secret).update("order_1|pay_1").digest("hex");

  it("accepts a correct signature and rejects tampered ones", () => {
    expect(verifyPaymentSignature("order_1", "pay_1", sig, secret)).toBe(true);
    expect(verifyPaymentSignature("order_1", "pay_2", sig, secret)).toBe(false);
    expect(verifyPaymentSignature("order_1", "pay_1", "deadbeef", secret)).toBe(false);
    expect(verifyPaymentSignature("", "", "", secret)).toBe(false);
  });

  const order: RazorpayOrder = { id: "order_1", amount: 129900, currency: "INR", receipt: "MM1", status: "paid", notes: [] };
  const pay = (over: Partial<RazorpayPayment> = {}): RazorpayPayment => ({
    id: "pay_1",
    order_id: "order_1",
    amount: 129900,
    currency: "INR",
    status: "captured",
    method: "upi",
    international: false,
    captured: true,
    ...over,
  });

  it("accepts domestic UPI, card and net banking payments in INR", () => {
    for (const method of ["upi", "card", "netbanking"]) expect(checkDomesticPayment(pay({ method }), order)).toBeNull();
  });

  it("rejects international, foreign-currency, other-method, wrong-amount and failed payments", () => {
    expect(checkDomesticPayment(pay({ international: true, method: "card" }), order)).toMatch(/International/);
    expect(checkDomesticPayment(pay({ currency: "USD" }), order)).toMatch(/INR/);
    expect(checkDomesticPayment(pay({ method: "wallet" }), order)).toMatch(/not supported/);
    expect(checkDomesticPayment(pay({ amount: 100 }), order)).toMatch(/amount/);
    expect(checkDomesticPayment(pay({ status: "failed" }), order)).toMatch(/not completed/);
    expect(checkDomesticPayment(pay({ order_id: "order_2" }), order)).toMatch(/belong/);
  });
});

describe("India-only delivery details", () => {
  const good = {
    customer: { fullName: "Anu Thomas", mobile: "+91 98470 12345", email: "anu@example.com" },
    address: { house: "12 Rose Villa", street: "Beach Road", city: "Alappuzha", district: "Alappuzha", state: "Kerala", pincode: "688012" },
  };

  it("accepts an Indian address and normalises the mobile number", () => {
    const r = parseCheckoutInput({ ...good, address: { ...good.address, country: "India" } });
    expect(r.ok && r.customer.mobile).toBe("9847012345");
  });

  it("rejects non-Indian countries, states and PIN codes", () => {
    expect(parseCheckoutInput({ ...good, address: { ...good.address, country: "United States" } }).ok).toBe(false);
    expect(parseCheckoutInput({ ...good, address: { ...good.address, state: "California" } }).ok).toBe(false);
    expect(parseCheckoutInput({ ...good, address: { ...good.address, pincode: "90210" } }).ok).toBe(false);
    expect(parseCheckoutInput({ ...good, address: { ...good.address, pincode: "012345" } }).ok).toBe(false);
  });

  it("client-side validation flags a non-Indian state", () => {
    expect(validateCheckout({ ...good.customer, ...good.address, state: "Texas" }).state).toBeDefined();
  });
});
