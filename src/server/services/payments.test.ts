import { createHmac, randomBytes } from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { NextRequest, type NextResponse } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as addLine } from "@/app/api/v1/cart/items/route";
import { POST as placeRoute } from "@/app/api/v1/checkout/orders/route";
import { GET as expireRoute } from "@/app/api/v1/cron/expire-orders/route";
import { GET as orderRoute } from "@/app/api/v1/orders/[id]/route";
import { POST as retryRoute } from "@/app/api/v1/payments/[orderId]/retry/route";
import { GET as statusRoute } from "@/app/api/v1/payments/[orderId]/status/route";
import { POST as createRoute } from "@/app/api/v1/payments/razorpay/create/route";
import { POST as verifyRoute } from "@/app/api/v1/payments/razorpay/verify/route";
import { POST as webhookRoute } from "@/app/api/v1/payments/razorpay/webhook/route";
import { POST as legacyOrderRoute } from "@/app/api/payments/razorpay/order/route";
import { getEnv, isConfigured, resetEnvCache } from "@/server/config/env";
import { connectToDatabase, disconnectFromDatabase } from "@/server/db/connect";
import * as models from "@/server/models";
import { Category, Coupon, CouponRedemption, InventoryMovement, Order, Payment, Product, Session, User, WebhookEvent, Cart } from "@/server/models";
import { resetRateLimits } from "@/server/security/rate-limit";
import { PROCESSING_GRACE_MS } from "./payment.service";

/* ---------- Fake Razorpay (stubbed fetch — no network, no real payments) ---------- */

const KEY_ID = "rzp_test_FakeKey1234";
const KEY_SECRET = "fake-key-secret-for-tests";
const WEBHOOK_SECRET = "fake-webhook-secret-for-tests";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>;
const rid = (p: string) => `${p}_${randomBytes(7).toString("hex")}`;

class FakeRazorpay {
  orders = new Map<string, Rec>();
  payments = new Map<string, Rec>();
  down = false;
  /** Tamper with the next created order (to prove we check Razorpay's reply). */
  nextOrderAmountDelta = 0;
  reset() {
    this.orders.clear();
    this.payments.clear();
    this.down = false;
    this.nextOrderAmountDelta = 0;
  }
  pay(orderId: string, over: Rec = {}) {
    const o = this.orders.get(orderId)!;
    const p = { id: rid("pay"), entity: "payment", order_id: orderId, amount: o.amount, currency: "INR", status: "captured", method: "upi", international: false, captured: true, bank: null, fee: 236, tax: 36, ...over };
    p.captured = p.status === "captured";
    this.payments.set(p.id, p);
    if (p.status === "captured") o.status = "paid";
    return p;
  }
  handle(url: string, init: RequestInit = {}): Response {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (this.down) throw new TypeError("fetch failed");
    const auth = new Headers(init.headers).get("authorization");
    if (auth !== `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`) return json({ error: { description: "Authentication failed" } }, 401);
    const path = url.replace("https://api.razorpay.com/v1", "");
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : {};
    let m: RegExpMatchArray | null;
    if (method === "POST" && path === "/orders") {
      const o = { id: rid("order"), entity: "order", amount: body.amount + this.nextOrderAmountDelta, currency: body.currency, receipt: body.receipt, notes: body.notes, status: "created" };
      this.nextOrderAmountDelta = 0;
      this.orders.set(o.id, o);
      return json(o);
    }
    if (method === "GET" && (m = path.match(/^\/orders\/([^/]+)\/payments$/))) return json({ items: [...this.payments.values()].filter((p) => p.order_id === m![1]) });
    if (method === "GET" && (m = path.match(/^\/payments\/([^/]+)$/))) {
      const p = this.payments.get(m[1]);
      return p ? json(p) : json({ error: { description: "The id provided does not exist" } }, 400);
    }
    if (method === "POST" && (m = path.match(/^\/payments\/([^/]+)\/capture$/))) {
      const p = this.payments.get(m[1]);
      if (!p || p.status !== "authorized" || body.amount !== p.amount || body.currency !== p.currency) return json({ error: { description: "cannot capture" } }, 400);
      Object.assign(p, { status: "captured", captured: true });
      this.orders.get(p.order_id)!.status = "paid";
      return json(p);
    }
    return json({ error: { description: "not found" } }, 404);
  }
}
const rzp = new FakeRazorpay();
const sign = (orderId: string, paymentId: string, secret = KEY_SECRET) => createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");

/* ---------- Harness ---------- */

const ORIGIN = "http://localhost:3000";
type Jar = Record<string, string>;
const ctx = <P extends Record<string, string>>(params: P = {} as P) => ({ params: Promise.resolve(params) });
let rs: MongoMemoryReplSet;
let ipSeq = 0;

function req(path: string, init: { method?: string; body?: unknown; raw?: string; jar?: Jar; origin?: string | null; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { "user-agent": "vitest", "x-forwarded-for": `10.3.${++ipSeq % 250}.1`, ...init.headers };
  if (init.body !== undefined || init.raw !== undefined) headers["content-type"] = "application/json";
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  if (init.jar && Object.keys(init.jar).length) headers.cookie = Object.entries(init.jar).map(([k, v]) => `${k}=${v}`).join("; ");
  return new NextRequest(`${ORIGIN}${path}`, { method: init.method ?? "POST", headers, body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)) });
}
const cookiesOf = (res: Response): Jar => Object.fromEntries((res as NextResponse).cookies.getAll().filter((c) => c.value).map((c) => [c.name, c.value]));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = { success: boolean; message: string; data: any; error?: { code: string } };
const json = async (res: Response) => (await res.clone().json()) as Body;
const call = async (res: Promise<Response> | Response) => {
  const r = await res;
  return { status: r.status, body: await json(r) };
};

const CUSTOMER = { fullName: "Anitha Menon", email: "anitha@example.com", mobile: "9876543210" };
const ADDRESS = { house: "12 Rose Villa", street: "MG Road", city: "Kochi", district: "Ernakulam", state: "Kerala", pincode: "682001" };
let seq = 0;
const key = () => `pay-test-${Date.now()}-${++seq}-abcdef`;

interface Placed {
  id: string;
  token: string | null;
  jar: Jar;
  totalPaise: number;
}

/** A pending order through the real Phase 4 checkout (guest by default). */
async function placeOrder({ jar = {} as Jar, quantity = 2, couponCode = null as string | null, sku = "M" } = {}): Promise<Placed> {
  const res = await addLine(req("/api/v1/cart/items", { body: { productId: kurti, size: sku, color: "Rose", quantity }, jar }), ctx());
  Object.assign(jar, cookiesOf(res));
  const unit = sku === "M" ? 129900 : 139900;
  const subtotal = unit * quantity;
  const discount = couponCode ? Math.min(Math.floor(subtotal / 10 / 100) * 100, 40000) : 0;
  const placed = await placeRoute(
    req("/api/v1/checkout/orders", {
      body: { source: { type: "cart" }, couponCode, customer: CUSTOMER, address: ADDRESS, paymentMethod: "upi", idempotencyKey: key(), expectedTotalPaise: subtotal - discount },
      jar,
    }),
    ctx(),
  );
  Object.assign(jar, cookiesOf(placed));
  const body = await json(placed);
  expect(placed.status, body.message).toBe(201);
  return { id: body.data.order.id, token: body.data.accessToken, jar, totalPaise: subtotal - discount };
}

const auth = (o: Placed): { jar: Jar; headers: Record<string, string> } => ({ jar: o.jar, headers: o.token ? { "x-order-token": o.token } : {} });
const create = (o: Placed, extra: Rec = {}) => call(createRoute(req("/api/v1/payments/razorpay/create", { body: { orderId: o.id, ...extra }, ...auth(o) }), ctx()));
const retry = (o: Placed) => call(retryRoute(req(`/api/v1/payments/${o.id}/retry`, { ...auth(o) }), ctx({ orderId: o.id })));
const status = (o: Placed, refresh = false) =>
  call(statusRoute(req(`/api/v1/payments/${o.id}/status${refresh ? "?refresh=1" : ""}`, { method: "GET", ...auth(o) }), ctx({ orderId: o.id })));
const verify = (o: Placed, cb: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature?: string }) =>
  call(verifyRoute(req("/api/v1/payments/razorpay/verify", { body: { orderId: o.id, razorpay_signature: sign(cb.razorpay_order_id, cb.razorpay_payment_id), ...cb }, ...auth(o) }), ctx()));
const viewOrder = async (o: Placed) => (await call(orderRoute(req(`/api/v1/orders/${o.id}`, { method: "GET", ...auth(o) }), ctx({ id: o.id })))).body.data;
const cron = () => call(expireRoute(req("/api/v1/cron/expire-orders", { method: "GET", headers: { authorization: `Bearer ${"c".repeat(32)}` } }), ctx()));

function webhook(event: string, entity: Rec, { eventId = rid("evt"), secret = WEBHOOK_SECRET, signature }: { eventId?: string; secret?: string; signature?: string } = {}) {
  const raw = JSON.stringify({ entity: "event", event, payload: { payment: { entity }, ...(event === "order.paid" ? { order: { entity: rzp.orders.get(entity.order_id) } } : {}) }, created_at: 1 });
  const sig = signature ?? createHmac("sha256", secret).update(raw).digest("hex");
  return call(webhookRoute(req("/api/v1/payments/razorpay/webhook", { raw, origin: null, headers: { "x-razorpay-signature": sig, "x-razorpay-event-id": eventId } }), ctx()));
}

const variant = async (sku: string) => {
  const p = await Product.findOne({ "variants.sku": sku }, { variants: 1, soldCount: 1 }).lean();
  return { ...p!.variants.find((v) => v.sku === sku)!, soldCount: p!.soldCount };
};
const orderDoc = (o: Placed) => Order.findOne({ orderNumber: o.id }).lean();
const expireNow = (o: Placed, msAgo = 1000) => Order.updateOne({ orderNumber: o.id }, { $set: { reservationExpiresAt: new Date(Date.now() - msAgo) } });

/* ---------- Fixtures ---------- */

let kurti: string;

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  vi.stubEnv("MONGODB_URI", rs.getUri());
  vi.stubEnv("MONGODB_DB_NAME", "mm-payments-test");
  vi.stubEnv("JWT_ACCESS_SECRET", "a".repeat(48));
  vi.stubEnv("JWT_REFRESH_SECRET", "r".repeat(48));
  vi.stubEnv("CRON_SECRET", "c".repeat(32));
  vi.stubEnv("RAZORPAY_KEY_ID", KEY_ID);
  vi.stubEnv("RAZORPAY_KEY_SECRET", KEY_SECRET);
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", WEBHOOK_SECRET);
  vi.stubEnv("RAZORPAY_ALLOW_LIVE", "");
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  resetEnvCache();
  await connectToDatabase();
  for (const m of Object.values(models)) {
    await m.createCollection();
    await m.syncIndexes();
  }
  const cat = await Category.create({ slug: "kurtis", audience: "women", name: "Kurtis" });
  kurti = (
    await Product.create({
      legacyId: "p001", slug: "rose-kurti", name: "Rose Kurti", sku: "MM-K1", audience: "women", category: cat._id, status: "active",
      pricePaise: 0, mrpPaise: 0, images: [{ url: "https://img.example/x.jpg" }],
      variants: [
        { sku: "MM-K1-M-ROSE", size: "M", color: { name: "Rose" }, pricePaise: 129900, mrpPaise: 189900, stock: 5 },
        { sku: "MM-K1-L-ROSE", size: "L", color: { name: "Rose" }, pricePaise: 139900, mrpPaise: 189900, stock: 2 },
      ],
    })
  ).legacyId!;
}, 240_000);

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => rzp.handle(String(input), init)));
  rzp.reset();
  await Promise.all(
    [Cart, User, Session, Order, Payment, CouponRedemption, InventoryMovement, WebhookEvent, Coupon].map((m) => (m as typeof Order).deleteMany({})),
  );
  await Coupon.create({ code: "WELCOME10", type: "percent", value: 10, maxDiscountPaise: 40000, startsAt: new Date(Date.now() - 86_400_000) });
  await Product.updateOne({ slug: "rose-kurti" }, { $set: { "variants.0.stock": 5, "variants.0.reserved": 0, "variants.1.stock": 2, "variants.1.reserved": 0, "variants.0.pricePaise": 129900, soldCount: 0, inStock: true } });
  resetRateLimits();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await disconnectFromDatabase();
  await rs?.stop();
});

/* ---------- Configuration ---------- */

describe("configuration", () => {
  it("refuses Live Mode keys unless explicitly allowed, and reports only variable names", () => {
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_live_RealLooking123");
    resetEnvCache();
    expect(isConfigured("razorpay")).toBe(false);
    vi.stubEnv("RAZORPAY_ALLOW_LIVE", "true");
    resetEnvCache();
    expect(getEnv("razorpay").RAZORPAY_KEY_ID).toBe("rzp_live_RealLooking123");
    vi.stubEnv("RAZORPAY_KEY_ID", KEY_ID);
    vi.stubEnv("RAZORPAY_ALLOW_LIVE", "");
    resetEnvCache();
  });

  it("missing credentials fail safely with 503 and no secrets in the response", async () => {
    const o = await placeOrder();
    vi.stubEnv("RAZORPAY_KEY_SECRET", "");
    resetEnvCache();
    const r = await create(o);
    vi.stubEnv("RAZORPAY_KEY_SECRET", KEY_SECRET);
    resetEnvCache();
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.body)).not.toMatch(/RAZORPAY|secret|rzp_/i);
    expect(rzp.orders.size).toBe(0);
  });

  it("retires the old product-priced payment routes", async () => {
    const res = await legacyOrderRoute();
    expect(res.status).toBe(410);
  });
});

/* ---------- Creating a Razorpay order ---------- */

describe("payment order creation", () => {
  it("charges exactly the stored order total in INR and returns only public checkout data", async () => {
    const o = await placeOrder({ quantity: 2, couponCode: "WELCOME10" });
    // A later price change must not affect what this order costs.
    await Product.updateOne({ "variants.sku": "MM-K1-M-ROSE" }, { $set: { "variants.$.pricePaise": 99900 } });
    const r = await create(o, { amount: 100, amountPaise: 100, currency: "USD", totalPaise: 1 });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ keyId: KEY_ID, mode: "test", amountPaise: o.totalPaise, currency: "INR", orderId: o.id, attempt: 1 });
    expect(r.body.data.prefill).toEqual({ name: CUSTOMER.fullName, email: CUSTOMER.email, contact: "+919876543210" });
    expect(JSON.stringify(r.body)).not.toContain(KEY_SECRET);
    const rp = rzp.orders.get(r.body.data.razorpayOrderId)!;
    expect(rp).toMatchObject({ amount: 233900, currency: "INR", receipt: `${o.id}-1` });
    expect(await Payment.findOne({ razorpayOrderId: rp.id }).lean()).toMatchObject({ attempt: 1, amountPaise: 233900, status: "created", mode: "test" });
    expect((await orderDoc(o))!.razorpayOrderId).toBe(rp.id);
  });

  it("refuses expired, ended and already-paid orders", async () => {
    const expired = await placeOrder();
    await expireNow(expired);
    expect((await create(expired)).body.error?.code).toBe("ORDER_EXPIRED");

    const cancelled = await placeOrder();
    await Order.updateOne({ orderNumber: cancelled.id }, { $set: { status: "cancelled", stockReleased: true } });
    const c = await create(cancelled);
    expect([c.status, c.body.error?.code]).toEqual([409, "ORDER_EXPIRED"]);

    const paid = await placeOrder();
    const start = await create(paid);
    const p = rzp.pay(start.body.data.razorpayOrderId);
    await verify(paid, { razorpay_order_id: p.order_id, razorpay_payment_id: p.id });
    expect((await create(paid)).body.error?.code).toBe("ALREADY_PAID");
    expect(rzp.orders.size).toBe(1);
  });

  it("only the order's owner can start a payment", async () => {
    const guest = await placeOrder();
    expect((await call(createRoute(req("/api/v1/payments/razorpay/create", { body: { orderId: guest.id } }), ctx()))).status).toBe(404);
    expect((await call(createRoute(req("/api/v1/payments/razorpay/create", { body: { orderId: guest.id }, jar: guest.jar }), ctx()))).status).toBe(404); // guest cookie alone isn't enough
    expect((await create(guest)).status).toBe(200);
    const crossSite = await call(createRoute(req("/api/v1/payments/razorpay/create", { body: { orderId: guest.id }, ...auth(guest), origin: "https://evil.example" }), ctx()));
    expect(crossSite.status).toBe(403);

    const owner = await call(register(req("/api/v1/auth/register", { body: { fullName: "Owner Person", email: "owner@example.com", mobile: "9800000001", password: "Kerala2026" } }), ctx()).then((r) => r));
    expect(owner.status).toBe(201);
  });

  it("customer orders: owner yes, other customers no", async () => {
    const signup = async (email: string, mobile: string) => cookiesOf(await register(req("/api/v1/auth/register", { body: { fullName: "Test Person", email, mobile, password: "Kerala2026" } }), ctx()));
    const alice = await signup("alice@example.com", "9800000011");
    const o = await placeOrder({ jar: alice });
    expect(o.token).toBeNull();
    expect((await create(o)).status).toBe(200);
    const bob = await signup("bob@example.com", "9800000012");
    expect((await create({ ...o, jar: bob })).status).toBe(404);
  });

  it("never creates two Razorpay orders for one active attempt — repeated or simultaneous", async () => {
    const o = await placeOrder();
    const results = await Promise.all([create(o), create(o), create(o)]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(new Set(results.map((r) => r.body.data.razorpayOrderId)).size).toBe(1);
    expect((await create(o)).body.data.razorpayOrderId).toBe(results[0].body.data.razorpayOrderId);
    expect(rzp.orders.size).toBe(1);
    expect(await Payment.countDocuments()).toBe(1);
  });

  it("rejects a Razorpay order created for the wrong amount", async () => {
    const o = await placeOrder();
    rzp.nextOrderAmountDelta = -100;
    const r = await create(o);
    expect(r.status).toBe(502);
    expect(await Payment.countDocuments()).toBe(0);
  });
});

/* ---------- Checkout callback verification ---------- */

describe("signature verification", () => {
  async function started(opts: Parameters<typeof placeOrder>[0] = {}) {
    const o = await placeOrder(opts);
    const s = await create(o);
    return { o, rpOrder: s.body.data.razorpayOrderId as string };
  }

  it("a valid, captured payment marks the order paid and turns the reserved stock into a sale", async () => {
    const { o, rpOrder } = await started({ quantity: 2, couponCode: "WELCOME10" });
    expect(await variant("MM-K1-M-ROSE")).toMatchObject({ stock: 5, reserved: 2 });
    const p = rzp.pay(rpOrder);
    const r = await verify(o, { razorpay_order_id: rpOrder, razorpay_payment_id: p.id });
    expect(r.status).toBe(200);
    expect(r.body.data.result).toBe("paid");
    expect(r.body.data.order).toMatchObject({ status: "Order Placed", paymentState: "paid", payment: { razorpayPaymentId: p.id, amount: 2339, currency: "INR", mode: "test" } });

    expect(await variant("MM-K1-M-ROSE")).toMatchObject({ stock: 3, reserved: 0, soldCount: 2 });
    const doc = await orderDoc(o);
    expect(doc).toMatchObject({ status: "placed", paymentStatus: "captured", razorpayPaymentId: p.id, paymentGateway: "razorpay", paymentMode: "test" });
    expect(doc!.placedAt).toBeTruthy();
    const sale = await InventoryMovement.find({ order: doc!._id, type: "sale" }).lean();
    expect(sale.map((m) => [m.variantSku, m.stockChange, m.reservedChange, m.stockAfter, m.reservedAfter])).toEqual([["MM-K1-M-ROSE", -2, -2, 3, 0]]);
    expect(await CouponRedemption.findOne({ order: doc!._id }).lean()).toMatchObject({ status: "redeemed" });
    expect((await Coupon.findOne({ code: "WELCOME10" }).lean())!.usageCount).toBe(1);
    expect(await Payment.findOne({ razorpayOrderId: rpOrder }).lean()).toMatchObject({ status: "captured", razorpayPaymentId: p.id, verifiedBy: "verify", method: "upi" });
  });

  it("captures an authorized payment for the stored amount before confirming", async () => {
    const { o, rpOrder } = await started();
    const p = rzp.pay(rpOrder, { status: "authorized" });
    const r = await verify(o, { razorpay_order_id: rpOrder, razorpay_payment_id: p.id });
    expect(r.body.data.result).toBe("paid");
    expect(rzp.payments.get(p.id)!.status).toBe("captured");
  });

  it("rejects an invalid signature, a substituted Razorpay order and a substituted payment", async () => {
    const { o, rpOrder } = await started();
    const p = rzp.pay(rpOrder);
    const bad = await verify(o, { razorpay_order_id: rpOrder, razorpay_payment_id: p.id, razorpay_signature: sign(rpOrder, p.id, "wrong-secret") });
    expect([bad.status, bad.body.error?.code]).toEqual([400, "PAYMENT_INVALID"]);

    // Another order's (genuinely signed) payment can't pay this order.
    const { o: other, rpOrder: otherRp } = await started({ sku: "L", quantity: 1 });
    const otherPay = rzp.pay(otherRp);
    const swappedOrder = await verify(o, { razorpay_order_id: otherRp, razorpay_payment_id: otherPay.id });
    expect([swappedOrder.status, swappedOrder.body.error?.code]).toEqual([400, "PAYMENT_INVALID"]);
    // This order's Razorpay order with someone else's payment ID (signed as if it were ours).
    const swappedPayment = await verify(o, { razorpay_order_id: rpOrder, razorpay_payment_id: otherPay.id });
    expect([swappedPayment.status, swappedPayment.body.error?.code]).toEqual([400, "PAYMENT_INVALID"]);
    // Malformed IDs never reach Razorpay.
    expect((await verify(o, { razorpay_order_id: "order_<x>", razorpay_payment_id: p.id })).status).toBe(400);

    expect((await orderDoc(o))!.paymentStatus).toBe("pending");
    expect((await orderDoc(other))!.paymentStatus).toBe("pending");
    expect(await InventoryMovement.countDocuments({ type: "sale" })).toBe(0);
  });

  it("a wrong amount or currency is never accepted — the order is flagged instead", async () => {
    const { o, rpOrder } = await started();
    const p = rzp.pay(rpOrder, { amount: 100 });
    const r = await verify(o, { razorpay_order_id: rpOrder, razorpay_payment_id: p.id });
    expect([r.status, r.body.error?.code]).toEqual([400, "PAYMENT_INVALID"]);
    let doc = await orderDoc(o);
    expect(doc).toMatchObject({ paymentStatus: "pending", status: "pending_payment", exception: { code: "PAYMENT_MISMATCH" } });

    const p2 = rzp.pay(rpOrder, { currency: "USD" });
    expect((await verify(o, { razorpay_order_id: rpOrder, razorpay_payment_id: p2.id })).status).toBe(400);
    const p3 = rzp.pay(rpOrder, { international: true });
    expect((await verify(o, { razorpay_order_id: rpOrder, razorpay_payment_id: p3.id })).status).toBe(400);
    doc = await orderDoc(o);
    expect(doc!.paymentStatus).toBe("pending");
    expect(await variant("MM-K1-M-ROSE")).toMatchObject({ stock: 5, reserved: 2 });
  });

  it("duplicate and replayed callbacks change nothing the second time", async () => {
    const { o, rpOrder } = await started();
    const p = rzp.pay(rpOrder);
    const cb = { razorpay_order_id: rpOrder, razorpay_payment_id: p.id };
    const results = await Promise.all([verify(o, cb), verify(o, cb), verify(o, cb)]);
    expect(results.every((r) => r.status === 200 && r.body.data.result === "paid")).toBe(true);
    expect((await verify(o, cb)).body.data.result).toBe("paid"); // replay later
    expect(await InventoryMovement.countDocuments({ type: "sale" })).toBe(1);
    expect(await variant("MM-K1-M-ROSE")).toMatchObject({ stock: 3, reserved: 0, soldCount: 2 });
  });

  it("a failed payment is recorded but keeps the stock reserved for a retry", async () => {
    const { o, rpOrder } = await started();
    const p = rzp.pay(rpOrder, { status: "failed", error_code: "BAD_REQUEST_ERROR", error_description: "Payment was declined by the bank" });
    const r = await verify(o, { razorpay_order_id: rpOrder, razorpay_payment_id: p.id });
    expect(r.body.data.result).toBe("failed");
    expect(r.body.data.order.paymentState).toBe("failed");
    expect(await variant("MM-K1-M-ROSE")).toMatchObject({ stock: 5, reserved: 2 });
    const s = await status(o);
    expect(s.body.data).toMatchObject({ canPay: true, paymentState: "failed", attempts: [{ attempt: 1, status: "failed", failure: "Payment was declined by the bank" }] });
  });
});

/* ---------- Webhooks ---------- */

describe("webhooks", () => {
  async function started() {
    const o = await placeOrder();
    const s = await create(o);
    return { o, rpOrder: s.body.data.razorpayOrderId as string };
  }

  it("rejects bad signatures and works only when the webhook secret is configured", async () => {
    const { rpOrder } = await started();
    const p = rzp.pay(rpOrder);
    expect((await webhook("payment.captured", p, { secret: "wrong" })).status).toBe(400);
    expect((await webhook("payment.captured", p, { signature: "" })).status).toBe(400);
    expect(await Order.countDocuments({ paymentStatus: "captured" })).toBe(0);
    expect(await WebhookEvent.countDocuments()).toBe(0); // nothing unverified is stored

    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "");
    resetEnvCache();
    expect((await webhook("payment.captured", p)).status).toBe(503);
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", WEBHOOK_SECRET);
    resetEnvCache();
  });

  it("payment.captured pays the order once; a redelivered event is acknowledged and ignored", async () => {
    const { o, rpOrder } = await started();
    const p = rzp.pay(rpOrder);
    const first = await webhook("payment.captured", p, { eventId: "evt_same_1" });
    expect(first.status).toBe(200);
    expect(first.body.data).toEqual({ duplicate: false, status: "paid" });
    const again = await webhook("payment.captured", p, { eventId: "evt_same_1" });
    expect(again.body.data.duplicate).toBe(true);
    // Same payment, different event (order.paid) — still only one sale.
    expect((await webhook("order.paid", p)).body.data.status).toBe("already_paid");
    expect((await orderDoc(o))!.status).toBe("placed");
    expect(await InventoryMovement.countDocuments({ type: "sale" })).toBe(1);
    expect((await WebhookEvent.findOne({ eventId: "evt_same_1" }).lean())!.status).toBe("processed");
    expect((await Payment.findOne({ razorpayOrderId: rpOrder }).lean())!.verifiedBy).toBe("webhook");
  });

  it("order.paid alone pays the order", async () => {
    const { o, rpOrder } = await started();
    const p = rzp.pay(rpOrder);
    expect((await webhook("order.paid", p)).body.data.status).toBe("paid");
    expect((await viewOrder(o)).status).toBe("Order Placed");
  });

  it("handles events in any order: a failure never undoes a success", async () => {
    const { o, rpOrder } = await started();
    const failed = rzp.pay(rpOrder, { status: "failed", error_description: "UPI request expired" });
    const ok = rzp.pay(rpOrder);
    expect((await webhook("payment.captured", ok)).body.data.status).toBe("paid");
    expect((await webhook("payment.failed", failed)).body.data.status).toBe("ignored");
    const doc = await orderDoc(o);
    expect(doc).toMatchObject({ status: "placed", paymentStatus: "captured", razorpayPaymentId: ok.id });

    // And failed → captured (the usual order) ends paid too.
    const { o: o2, rpOrder: rp2 } = await started();
    expect((await webhook("payment.failed", rzp.pay(rp2, { status: "failed" }))).body.data.status).toBe("recorded");
    expect((await webhook("payment.captured", rzp.pay(rp2))).body.data.status).toBe("paid");
    expect((await orderDoc(o2))!.paymentStatus).toBe("captured");
  });

  it("acknowledges unknown events and payments for unknown orders without changing anything", async () => {
    const r = await webhook("refund.created", { id: rid("pay"), order_id: rid("order") });
    expect(r.body.data.status).toBe("ignored");
    const stranger = await webhook("payment.captured", { id: rid("pay"), order_id: "order_notours123", amount: 100, currency: "INR", status: "captured", method: "upi" });
    expect(stranger.body.data.status).toBe("unknown_order");
  });

  it("a webhook that fails is reported (5xx) and processed when Razorpay retries it", async () => {
    const { o, rpOrder } = await started();
    const p = rzp.pay(rpOrder);
    vi.spyOn(InventoryMovement, "insertMany").mockRejectedValueOnce(new Error("simulated outage"));
    const first = await webhook("payment.captured", p, { eventId: "evt_retry_1" });
    expect(first.status).toBe(500);
    expect(JSON.stringify(first.body)).not.toContain("simulated");
    expect((await orderDoc(o))!.paymentStatus).toBe("pending"); // rolled back
    expect(await variant("MM-K1-M-ROSE")).toMatchObject({ stock: 5, reserved: 2 });
    expect((await WebhookEvent.findOne({ eventId: "evt_retry_1" }).lean())!.status).toBe("failed");

    const retried = await webhook("payment.captured", p, { eventId: "evt_retry_1" });
    expect(retried.body.data).toEqual({ duplicate: false, status: "paid" });
    expect((await WebhookEvent.findOne({ eventId: "evt_retry_1" }).lean())).toMatchObject({ status: "processed", attempts: 2 });
  });

  it("the checkout callback and the webhook racing each other complete the payment once", async () => {
    const { o, rpOrder } = await started();
    const p = rzp.pay(rpOrder);
    await Promise.all([verify(o, { razorpay_order_id: rpOrder, razorpay_payment_id: p.id }), webhook("payment.captured", p), webhook("order.paid", p)]);
    expect(await InventoryMovement.countDocuments({ type: "sale" })).toBe(1);
    expect(await variant("MM-K1-M-ROSE")).toMatchObject({ stock: 3, reserved: 0 });
  });
});

/* ---------- Expiry & the stock lifecycle ---------- */

describe("reservation expiry with payments", () => {
  it("releases an order that never started payment, or whose payments all failed — exactly once", async () => {
    const never = await placeOrder({ quantity: 1 });
    const failed = await placeOrder({ quantity: 1 });
    const rp = (await create(failed)).body.data.razorpayOrderId;
    rzp.pay(rp, { status: "failed" });
    await expireNow(never);
    await expireNow(failed);
    const runs = await Promise.all([cron(), cron()]);
    expect(runs.reduce((n, r) => n + r.body.data.expired, 0)).toBe(2);
    expect(await variant("MM-K1-M-ROSE")).toMatchObject({ stock: 5, reserved: 0 });
    expect(await InventoryMovement.countDocuments({ type: "release" })).toBe(2);
    expect((await orderDoc(failed))!.status).toBe("expired");
  });

  it("never releases an order whose payment was captured — it's completed instead (missed webhook)", async () => {
    const o = await placeOrder();
    const rp = (await create(o)).body.data.razorpayOrderId;
    rzp.pay(rp); // captured at Razorpay, but neither callback nor webhook reached us
    await expireNow(o);
    expect((await cron()).body.data.expired).toBe(0);
    expect((await orderDoc(o))!.status).toBe("placed");
    expect(await InventoryMovement.countDocuments({ type: "release" })).toBe(0);
    expect(await InventoryMovement.countDocuments({ type: "sale" })).toBe(1);
  });

  it("keeps stock while a payment is still processing, up to a grace period", async () => {
    const o = await placeOrder();
    const rp = (await create(o)).body.data.razorpayOrderId;
    rzp.pay(rp, { status: "created" });
    await expireNow(o);
    expect((await cron()).body.data.expired).toBe(0);
    expect((await orderDoc(o))!.status).toBe("pending_payment");
    await expireNow(o, PROCESSING_GRACE_MS + 60_000);
    expect((await cron()).body.data.expired).toBe(1);
  });

  it("keeps stock when Razorpay can't be reached", async () => {
    const o = await placeOrder();
    await create(o);
    rzp.down = true;
    await expireNow(o);
    expect((await cron()).body.data.expired).toBe(0);
    expect((await orderDoc(o))!.stockReleased).toBe(false);
  });

  it("payment success racing expiry ends consistent: stock sold once, never both sold and released", async () => {
    for (let i = 0; i < 4; i++) {
      await Product.updateOne({ slug: "rose-kurti" }, { $set: { "variants.0.stock": 5, "variants.0.reserved": 0 } });
      const o = await placeOrder({ quantity: 1 });
      const rp = (await create(o)).body.data.razorpayOrderId;
      const p = rzp.pay(rp);
      await expireNow(o);
      await Promise.all([cron(), verify(o, { razorpay_order_id: rp, razorpay_payment_id: p.id })]);
      const doc = await orderDoc(o);
      expect(doc!.paymentStatus).toBe("captured");
      expect(doc!.status).toBe("placed");
      const v = await variant("MM-K1-M-ROSE");
      expect(v.stock - v.reserved).toBe(4); // exactly one unit gone
      const moves = await InventoryMovement.find({ order: doc!._id }).lean();
      expect(moves.filter((m) => m.type === "sale")).toHaveLength(1);
    }
  });

  it("a payment arriving after expiry is honoured from available stock, with its coupon re-counted", async () => {
    const o = await placeOrder({ quantity: 1, couponCode: "WELCOME10" });
    const rp = (await create(o)).body.data.razorpayOrderId;
    await expireNow(o);
    await cron();
    expect((await orderDoc(o))!.status).toBe("expired");
    expect((await Coupon.findOne({ code: "WELCOME10" }).lean())!.usageCount).toBe(0);

    const p = rzp.pay(rp);
    expect((await webhook("payment.captured", p)).body.data.status).toBe("late_paid");
    const doc = await orderDoc(o);
    expect(doc).toMatchObject({ status: "placed", paymentStatus: "captured" });
    expect(await variant("MM-K1-M-ROSE")).toMatchObject({ stock: 4, reserved: 0 });
    expect((await Coupon.findOne({ code: "WELCOME10" }).lean())!.usageCount).toBe(1);
    expect(await CouponRedemption.findOne({ order: doc!._id }).lean()).toMatchObject({ status: "redeemed" });
  });

  it("a payment after expiry when the stock is gone is flagged for a refund, never oversold", async () => {
    const o = await placeOrder({ sku: "L", quantity: 2 }); // both L units
    const rp = (await create(o)).body.data.razorpayOrderId;
    await expireNow(o);
    await cron();
    const other = await placeOrder({ sku: "L", quantity: 2 }); // someone else takes them
    expect(other.id).toBeTruthy();
    const p = rzp.pay(rp);
    expect((await webhook("payment.captured", p)).body.data.status).toBe("late_unfulfillable");
    const doc = await orderDoc(o);
    expect(doc).toMatchObject({ status: "expired", paymentStatus: "captured", exception: { code: "PAID_AFTER_EXPIRY" } });
    expect(await variant("MM-K1-L-ROSE")).toMatchObject({ stock: 2, reserved: 2 }); // the other order's hold, untouched
    expect((await viewOrder(o)).paymentState).toBe("paid");
  });
});

/* ---------- Retry ---------- */

describe("payment retry", () => {
  it("creates a new attempt within the hold — same order, same total, no new reservation", async () => {
    const o = await placeOrder();
    const first = (await create(o)).body.data;
    rzp.pay(first.razorpayOrderId, { status: "failed" });
    const r = await retry(o);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ attempt: 2, amountPaise: o.totalPaise });
    expect(r.body.data.razorpayOrderId).not.toBe(first.razorpayOrderId);
    expect(await Payment.countDocuments({ order: (await orderDoc(o))!._id })).toBe(2);
    expect(await InventoryMovement.countDocuments({ type: "reservation" })).toBe(1);
    expect(await Order.countDocuments()).toBe(1);

    // Paying the new attempt completes the order.
    const p = rzp.pay(r.body.data.razorpayOrderId);
    expect((await verify(o, { razorpay_order_id: p.order_id, razorpay_payment_id: p.id })).body.data.result).toBe("paid");
    const attempts = (await status(o)).body.data.attempts;
    expect(attempts.map((a: { status: string }) => a.status)).toEqual(["failed", "captured"]);
  });

  it("refuses a retry after the hold has run out", async () => {
    const o = await placeOrder();
    await create(o);
    await expireNow(o);
    const r = await retry(o);
    expect([r.status, r.body.error?.code]).toEqual([409, "ORDER_EXPIRED"]);
    expect(r.body.message).toMatch(/new order/);
  });

  it("simultaneous retries create one attempt", async () => {
    const o = await placeOrder();
    rzp.pay((await create(o)).body.data.razorpayOrderId, { status: "failed" });
    const results = await Promise.all([retry(o), retry(o), retry(o)]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409 && r.body.error?.code === "PAYMENT_IN_PROGRESS")).toHaveLength(2);
    expect(rzp.orders.size).toBe(2);
  });

  it("waits while an earlier payment is still processing", async () => {
    const o = await placeOrder();
    rzp.pay((await create(o)).body.data.razorpayOrderId, { status: "created" });
    const r = await retry(o);
    expect([r.status, r.body.error?.code]).toEqual([409, "PAYMENT_IN_PROGRESS"]);
    expect(rzp.orders.size).toBe(1);
  });

  it("after a successful payment (even one we hadn't heard about yet) a retry is refused and the order completes", async () => {
    const o = await placeOrder();
    rzp.pay((await create(o)).body.data.razorpayOrderId); // captured, no callback/webhook yet
    const r = await retry(o);
    expect([r.status, r.body.error?.code]).toEqual([409, "ALREADY_PAID"]);
    expect((await orderDoc(o))!.status).toBe("placed");
    expect((await retry(o)).body.error?.code).toBe("ALREADY_PAID");
    expect(rzp.orders.size).toBe(1);
  });

  it("status?refresh=1 discovers a payment the browser never reported", async () => {
    const o = await placeOrder();
    rzp.pay((await create(o)).body.data.razorpayOrderId);
    expect((await status(o)).body.data.paymentState).toBe("pending");
    const s = await status(o, true);
    expect(s.body.data).toMatchObject({ paymentState: "paid", status: "Order Placed", canPay: false });
    // Status is private too.
    const stranger = await call(statusRoute(req(`/api/v1/payments/${o.id}/status`, { method: "GET" }), ctx({ orderId: o.id })));
    expect(stranger.status).toBe(404);
  });
});
