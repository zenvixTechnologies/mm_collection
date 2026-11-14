import type { OrderItem } from "@/types";
import { ORDER_STATUSES } from "@/types";
import type { AdminCustomer, AdminOrder, AdminOrderStatus, PaymentTransaction } from "@/types/admin";
import { findCoupon } from "@/data/coupons";
import { sampleOrders } from "@/data/orders";
import { couponDiscount } from "@/lib/pricing";
import { mockProducts } from "./catalog";
import { mockCustomers } from "./customers";
import { MOCK_NOW, createRng, daysAgo, hoursAfter } from "./mock-utils";

export const COURIERS = ["Delhivery", "Blue Dart", "DTDC", "India Post"] as const;

const rng = createRng(1411);
const sellable = mockProducts.filter((p) => p.status === "active");

/** Hours after placing an order at which each later status was reached. */
const STATUS_GAPS = [0, 2, 20, 30, 70, 80];

function historyFor(createdAt: string, status: AdminOrderStatus): AdminOrder["history"] {
  if (status === "Cancelled") {
    return { "Order Placed": createdAt, Cancelled: hoursAfter(createdAt, 5) };
  }
  const reached = ORDER_STATUSES.slice(0, ORDER_STATUSES.indexOf(status) + 1);
  return Object.fromEntries(reached.map((s, i) => [s, hoursAfter(createdAt, STATUS_GAPS[i])]));
}

function statusForAge(days: number): AdminOrderStatus {
  if (rng.chance(0.04)) return "Cancelled";
  if (days < 2) return rng.pick(["Order Placed", "Order Placed", "Confirmed"] as const);
  if (days < 3) return rng.pick(["Confirmed", "Processing"] as const);
  if (days < 5) return rng.pick(["Processing", "Shipped"] as const);
  if (days < 6) return rng.pick(["Shipped", "Out for Delivery", "Delivered"] as const);
  return "Delivered";
}

function itemsFor(customer: AdminCustomer): OrderItem[] {
  const count = rng.chance(0.6) ? 1 : rng.chance(0.75) ? 2 : 3;
  const preferred = sellable.filter((p) => p.audienceCategory === customer.primaryAudience);
  const items: OrderItem[] = [];
  for (let i = 0; i < count; i++) {
    const pool = rng.chance(0.8) && preferred.length ? preferred : sellable;
    const p = rng.pick(pool);
    if (items.some((it) => it.productId === p.id)) continue;
    items.push({
      productId: p.id,
      audience: p.audienceCategory,
      slug: p.slug,
      name: p.name,
      image: p.images[0],
      price: p.price,
      size: rng.pick(p.sizes),
      color: rng.pick(p.colors).name,
      quantity: rng.chance(0.85) ? 1 : 2,
    });
  }
  return items;
}

function razorpayId(prefix: string) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 14; i++) s += chars[rng.int(0, chars.length - 1)];
  return `${prefix}_${s}`;
}

let seq = 0;
function orderId() {
  seq += 1;
  return `MM25${(46656 + seq * 977).toString(36).toUpperCase().slice(-4)}`;
}

const METHOD_DETAIL = {
  upi: ["Google Pay", "PhonePe", "Paytm", "BHIM UPI"],
  card: ["Visa ···· 4417", "Mastercard ···· 0921", "RuPay ···· 3380", "Visa ···· 7712"],
  netbanking: ["Federal Bank", "SBI", "HDFC Bank", "South Indian Bank"],
} as const;

const payments: PaymentTransaction[] = [];

function buildOrder(customer: AdminCustomer, createdAt: string, ageDays: number): AdminOrder {
  const items = itemsFor(customer);
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const couponCode = rng.chance(0.3) ? rng.pick(["WELCOME10", "FIRSTORDER", "SAVE15", "FESTIVE20"]) : null;
  const coupon = couponCode ? findCoupon(couponCode) : undefined;
  const discount = coupon && subtotal >= coupon.minOrder ? couponDiscount(coupon, subtotal) : 0;
  const total = subtotal - discount;
  const status = statusForAge(ageDays);
  const method = rng.chance(0.6) ? "upi" : rng.chance(0.6) ? "card" : "netbanking";
  const id = orderId();
  const rzpOrder = razorpayId("order");
  const rzpPay = razorpayId("pay");
  const paymentStatus = status === "Cancelled" ? "refunded" : "captured";

  payments.push({
    id: `txn-${id}`,
    razorpayPaymentId: rzpPay,
    razorpayOrderId: rzpOrder,
    orderId: id,
    customerId: customer.id,
    customerName: customer.fullName,
    email: customer.email,
    method,
    methodDetail: rng.pick(METHOD_DETAIL[method]),
    amount: total,
    fee: Math.round(total * 0.02 * 1.18),
    refundedAmount: paymentStatus === "refunded" ? total : 0,
    status: paymentStatus,
    mode: "test",
    createdAt,
  });

  const shipped = ["Shipped", "Out for Delivery", "Delivered"].includes(status);
  const courier = rng.pick(COURIERS);
  return {
    id,
    createdAt,
    items,
    customer: { fullName: customer.fullName, mobile: customer.mobile, email: customer.email },
    address: customer.addresses[0],
    paymentMethod: method,
    payment: { provider: "razorpay", mode: "test", razorpayOrderId: rzpOrder, razorpayPaymentId: rzpPay, currency: "INR", amount: total },
    couponCode: discount > 0 ? couponCode : null,
    subtotal,
    discount,
    shipping: null,
    total,
    status,
    history: historyFor(createdAt, status),
    customerId: customer.id,
    paymentStatus,
    tracking: shipped
      ? {
          courier,
          awb: `${courier.slice(0, 2).toUpperCase()}${rng.int(100000000, 999999999)}`,
          shippedAt: hoursAfter(createdAt, 30),
        }
      : undefined,
    notes: [],
  };
}

/* ---------- Generated orders: ~100 days, busier towards today (festive season) ---------- */

const generated: AdminOrder[] = [];
const shoppers = mockCustomers.filter((c) => c.status === "active" && c.id !== "u-demo");
for (let day = 100; day >= 0; day--) {
  const perDay = day < 20 ? rng.int(1, 4) : day < 50 ? rng.int(0, 3) : rng.int(0, 2);
  for (let n = 0; n < perDay; n++) {
    const customer = rng.pick(shoppers);
    if (new Date(customer.joinedAt).getTime() > new Date(daysAgo(day)).getTime()) continue;
    const createdAt = daysAgo(day, rng.int(8, 22), rng.int(0, 59));
    if (new Date(createdAt).getTime() > MOCK_NOW.getTime()) continue;
    generated.push(buildOrder(customer, createdAt, day));
  }
}

/* ---------- The storefront demo account's sample orders, so both sides tell the same story ---------- */

const demoOrders: AdminOrder[] = sampleOrders.map((o) => {
  const rzpOrder = razorpayId("order");
  const rzpPay = razorpayId("pay");
  const method = o.paymentMethod === "cod" ? "upi" : o.paymentMethod;
  payments.push({
    id: `txn-${o.id}`,
    razorpayPaymentId: rzpPay,
    razorpayOrderId: rzpOrder,
    orderId: o.id,
    customerId: "u-demo",
    customerName: o.customer.fullName,
    email: o.customer.email,
    method,
    methodDetail: rng.pick(METHOD_DETAIL[method]),
    amount: o.total,
    fee: Math.round(o.total * 0.02 * 1.18),
    refundedAmount: 0,
    status: "captured",
    mode: "test",
    createdAt: o.createdAt,
  });
  const shipped = ["Shipped", "Out for Delivery", "Delivered"].includes(o.status);
  return {
    ...o,
    paymentMethod: method,
    payment: { provider: "razorpay", mode: "test", razorpayOrderId: rzpOrder, razorpayPaymentId: rzpPay, currency: "INR", amount: o.total },
    customerId: "u-demo",
    paymentStatus: "captured",
    tracking: shipped ? { courier: "Delhivery", awb: `DE${rng.int(100000000, 999999999)}`, shippedAt: o.history.Shipped } : undefined,
    notes: [],
  };
});

/* ---------- Failed payment attempts (no store order is created for these) ---------- */

const FAILURES = [
  "Payment declined by the issuing bank",
  "UPI request expired before approval",
  "Customer closed the payment window",
  "Insufficient funds",
  "Incorrect OTP entered",
];
for (let i = 0; i < 9; i++) {
  const c = rng.pick(shoppers);
  const method = rng.pick(["upi", "card", "netbanking"] as const);
  const amount = rng.int(8, 45) * 100 - 1;
  payments.push({
    id: `txn-failed-${i}`,
    razorpayPaymentId: razorpayId("pay"),
    razorpayOrderId: razorpayId("order"),
    orderId: null,
    customerId: c.id,
    customerName: c.fullName,
    email: c.email,
    method,
    methodDetail: rng.pick(METHOD_DETAIL[method]),
    amount,
    fee: 0,
    refundedAmount: 0,
    status: "failed",
    mode: "test",
    createdAt: daysAgo(rng.int(0, 40), rng.int(9, 23), rng.int(0, 59)),
    errorReason: rng.pick(FAILURES),
  });
}

const byNewest = (a: { createdAt: string }, b: { createdAt: string }) => b.createdAt.localeCompare(a.createdAt);

export const mockOrders: AdminOrder[] = [...generated, ...demoOrders].sort(byNewest);
export const mockPayments: PaymentTransaction[] = payments.sort(byNewest);
