import { createHmac, randomBytes } from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { NextRequest, type NextResponse } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as adminLogin } from "@/app/api/v1/admin/auth/login/route";
import { POST as bulkRoute } from "@/app/api/v1/admin/orders/bulk-status/route";
import { GET as adminOrderRoute } from "@/app/api/v1/admin/orders/[id]/route";
import { PATCH as statusRoute } from "@/app/api/v1/admin/orders/[id]/status/route";
import { GET as paymentRoute } from "@/app/api/v1/admin/payments/[id]/route";
import { POST as refundRoute } from "@/app/api/v1/admin/payments/[id]/refunds/route";
import { POST as syncRoute } from "@/app/api/v1/admin/payments/[id]/refunds/[refundId]/route";
import { POST as addLine } from "@/app/api/v1/cart/items/route";
import { POST as placeRoute } from "@/app/api/v1/checkout/orders/route";
import { GET as expireRoute } from "@/app/api/v1/cron/expire-orders/route";
import { POST as retryRoute } from "@/app/api/v1/payments/[orderId]/retry/route";
import { POST as createRoute } from "@/app/api/v1/payments/razorpay/create/route";
import { POST as webhookRoute } from "@/app/api/v1/payments/razorpay/webhook/route";
import { hashPassword } from "@/server/auth/password";
import { DEFAULT_ROLE_PERMISSIONS } from "@/server/auth/permissions";
import { resetEnvCache } from "@/server/config/env";
import { connectToDatabase, disconnectFromDatabase } from "@/server/db/connect";
import * as models from "@/server/models";
import { Admin, Cart, Category, Coupon, CouponRedemption, InventoryMovement, Order, Payment, Product, Role, WebhookEvent } from "@/server/models";
import { resetRateLimits } from "@/server/security/rate-limit";

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }));

/**
 * Payment, refund and stock integrity: late-paid cancellations, refunds of duplicate payments and
 * out-of-order refund updates. Real API routes, an in-memory replica set and a fake Razorpay —
 * no real gateway call or money.
 */

const KEY_ID = "rzp_test_Integrity123";
const KEY_SECRET = "integrity-key-secret";
const WEBHOOK_SECRET = "integrity-webhook-secret";
const ORIGIN = "http://localhost:3000";
const PW = "Correct-horse-42";
const SKU = "MM-K1-M-ROSE";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>;
const rid = (p: string) => `${p}_${randomBytes(7).toString("hex")}`;

/* ---------- Fake Razorpay ---------- */

const rz = {
  orders: new Map<string, Rec>(),
  payments: new Map<string, Rec>(),
  refunds: new Map<string, Rec>(),
  refundStatus: "processed" as "processed" | "pending",
  /** Runs after Razorpay has made a refund but before its answer reaches us. */
  beforeRefundReply: null as null | ((refund: Rec) => Promise<void>),
  reset() {
    this.orders.clear();
    this.payments.clear();
    this.refunds.clear();
    this.refundStatus = "processed";
    this.beforeRefundReply = null;
  },
  /** The customer pays a Razorpay order. */
  pay(orderId: string) {
    const o = this.orders.get(orderId)!;
    const p = { id: rid("pay"), order_id: orderId, amount: o.amount, currency: "INR", status: "captured", method: "upi", international: false, captured: true, fee: 0, tax: 0 };
    this.payments.set(p.id, p);
    return p;
  },
  async handle(url: string, init: RequestInit = {}): Promise<Response> {
    if (!url.startsWith("https://api.razorpay.com/v1")) throw new Error(`Unexpected network call: ${url}`);
    const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
    const path = url.replace("https://api.razorpay.com/v1", "").split("?")[0];
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : {};
    let m: RegExpMatchArray | null;
    if (method === "POST" && path === "/orders") {
      const o = { id: rid("order"), amount: body.amount, currency: body.currency, receipt: body.receipt, notes: body.notes, status: "created" };
      this.orders.set(o.id, o);
      return json(o);
    }
    if (method === "GET" && (m = path.match(/^\/orders\/([^/]+)\/payments$/))) return json({ items: [...this.payments.values()].filter((p) => p.order_id === m![1]) });
    if (method === "GET" && (m = path.match(/^\/payments\/([^/]+)$/))) {
      const id = m[1];
      const refunded = [...this.refunds.values()].filter((r) => r.payment_id === id && r.status !== "failed").reduce((s, r) => s + r.amount, 0);
      return json({ ...this.payments.get(id), amount_refunded: refunded });
    }
    if (method === "POST" && (m = path.match(/^\/payments\/([^/]+)\/refund$/))) {
      const refund = { id: `rfnd_${randomBytes(7).toString("hex")}`, entity: "refund", amount: body.amount, currency: "INR", payment_id: m[1], status: this.refundStatus, notes: body.notes };
      this.refunds.set(refund.id, refund);
      const reply = { ...refund };
      await this.beforeRefundReply?.(refund);
      return json(reply);
    }
    if (method === "GET" && (m = path.match(/^\/payments\/[^/]+\/refunds\/([^/]+)$/))) return json(this.refunds.get(m[1]));
    return json({ error: { description: "not found" } }, 404);
  },
};

/* ---------- Harness ---------- */

type Jar = Record<string, string>;
const ctx = <P extends Record<string, string>>(params: P = {} as P) => ({ params: Promise.resolve(params) });
let rs: MongoMemoryReplSet;
let admin: Jar = {};
let productId: string;
let seq = 0;

function req(path: string, init: { method?: string; body?: unknown; raw?: string; jar?: Jar; origin?: string | null; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { "x-forwarded-for": `10.7.${++seq % 250}.1`, ...init.headers };
  if (init.body !== undefined || init.raw !== undefined) headers["content-type"] = "application/json";
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  if (init.jar && Object.keys(init.jar).length) headers.cookie = Object.entries(init.jar).map(([k, v]) => `${k}=${v}`).join("; ");
  return new NextRequest(`${ORIGIN}${path}`, { method: init.method ?? "POST", headers, body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)) });
}
const cookiesOf = (res: Response): Jar => Object.fromEntries((res as NextResponse).cookies.getAll().filter((c) => c.value).map((c) => [c.name, c.value]));
type Body = { success: boolean; message: string; data: Rec; error?: { code: string } };
const call = async (res: Promise<Response> | Response) => {
  const r = await res;
  return { status: r.status, body: (await r.clone().json()) as Body };
};

interface Placed {
  id: string;
  token: string;
  totalPaise: number;
}

/** A guest checkout of `quantity` units (₹1,000 each), optionally with a coupon. */
async function placeOrder({ quantity = 2, couponCode = null as string | null } = {}): Promise<Placed> {
  const jar: Jar = {};
  Object.assign(jar, cookiesOf(await addLine(req("/api/v1/cart/items", { body: { productId: "p001", size: "M", color: "Rose", quantity }, jar }), ctx())));
  const totalPaise = quantity * 100000 - (couponCode ? 10000 : 0);
  const r = await call(
    placeRoute(
      req("/api/v1/checkout/orders", {
        jar,
        body: {
          source: { type: "cart" },
          couponCode,
          customer: { fullName: "Anitha Menon", email: "anitha@example.com", mobile: "9876543210" },
          address: { house: "12 Rose Villa", street: "MG Road", city: "Kochi", district: "Ernakulam", state: "Kerala", pincode: "682001" },
          paymentMethod: "upi",
          idempotencyKey: `integrity-${Date.now()}-${++seq}-abcdef`,
          expectedTotalPaise: totalPaise,
        },
      }),
      ctx(),
    ),
  );
  expect(r.status, r.body.message).toBe(201);
  return { id: r.body.data.order.id, token: r.body.data.accessToken, totalPaise };
}

const guest = (o: Placed) => ({ "x-order-token": o.token });
const startPayment = async (o: Placed) => (await call(createRoute(req("/api/v1/payments/razorpay/create", { body: { orderId: o.id }, headers: guest(o) }), ctx()))).body.data.razorpayOrderId as string;
const retryPayment = async (o: Placed) => (await call(retryRoute(req(`/api/v1/payments/${o.id}/retry`, { headers: guest(o) }), ctx({ orderId: o.id })))).body.data.razorpayOrderId as string;

function webhook(event: string, payload: Rec, eventId = rid("evt")) {
  const raw = JSON.stringify({ entity: "event", event, payload, created_at: 1 });
  const signature = createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
  return call(webhookRoute(req("/api/v1/payments/razorpay/webhook", { raw, origin: null, headers: { "x-razorpay-signature": signature, "x-razorpay-event-id": eventId } }), ctx()));
}
const captured = (p: Rec) => webhook("payment.captured", { payment: { entity: p } });
const refundEvent = (type: string, refund: Rec, status: string) => webhook(`refund.${type}`, { refund: { entity: { ...refund, status } } });

/** Expires the unpaid order exactly as production does: the hold runs out and the cron releases it. */
async function expire(o: Placed) {
  await Order.updateOne({ orderNumber: o.id }, { $set: { reservationExpiresAt: new Date(Date.now() - 1000) } });
  const r = await call(expireRoute(req("/api/v1/cron/expire-orders", { method: "GET", headers: { authorization: `Bearer ${"c".repeat(32)}` } }), ctx()));
  expect(r.status).toBe(200);
  expect((await orderDoc(o)).status).toBe("expired");
}

const orderDoc = async (o: Placed) => (await Order.findOne({ orderNumber: o.id }).lean())!;
const paymentDoc = async (razorpayPaymentId: string) => (await Payment.findOne({ razorpayPaymentId }).lean())!;
const stock = async () => {
  const p = (await Product.findById(productId, { variants: 1, soldCount: 1 }).lean())!;
  return { stock: p.variants[0].stock, reserved: p.variants[0].reserved, sold: p.soldCount };
};
/** The ledger for one order: [type, stock change, reserved change]. */
const ledger = async (o: Placed) =>
  (await InventoryMovement.find({ order: (await orderDoc(o))._id }).sort({ createdAt: 1, _id: 1 }).lean()).map((m) => [m.type, m.stockChange, m.reservedChange]);
/** Stock invariant: the units gone from the shelf equal the net on-hand change in the ledger. */
const ledgerStockChange = async () => (await InventoryMovement.find().lean()).reduce((n, m) => n + m.stockChange, 0);

const setStatus = (o: Placed, status: string) => call(statusRoute(req(`/api/v1/admin/orders/${o.id}/status`, { method: "PATCH", body: { status }, jar: admin }), ctx({ id: o.id })));
const adminOrder = async (o: Placed) => (await call(adminOrderRoute(req(`/api/v1/admin/orders/${o.id}`, { method: "GET", jar: admin }), ctx({ id: o.id })))).body.data;
const paymentDetail = async (id: string) => (await call(paymentRoute(req(`/api/v1/admin/payments/${id}`, { method: "GET", jar: admin }), ctx({ id })))).body.data;
const adminRefund = (paymentId: string, body: Rec = {}) =>
  call(refundRoute(req(`/api/v1/admin/payments/${paymentId}/refunds`, { body: { reason: "Integrity test", idempotencyKey: `refund-${randomBytes(12).toString("hex")}`, ...body }, jar: admin }), ctx({ id: paymentId })));
const syncRefund = (paymentId: string, refundId: string) =>
  call(syncRoute(req(`/api/v1/admin/payments/${paymentId}/refunds/${refundId}`, { body: {}, jar: admin }), ctx({ id: paymentId, refundId })));

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  vi.stubEnv("MONGODB_URI", rs.getUri());
  vi.stubEnv("MONGODB_DB_NAME", "mm-integrity-test");
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
  const role = await Role.create({ key: "owner", name: "owner", permissions: [...DEFAULT_ROLE_PERMISSIONS.owner] });
  await Admin.create({ name: "owner admin", email: "owner@t.in", passwordHash: await hashPassword(PW), role: role._id });
  const res = await adminLogin(req("/api/v1/admin/auth/login", { body: { identifier: "owner@t.in", password: PW } }), ctx());
  expect(res.status).toBe(200);
  admin = cookiesOf(res);
  const cat = await Category.create({ slug: "kurtis", audience: "women", name: "Kurtis" });
  productId = String(
    (
      await Product.create({
        legacyId: "p001", slug: "rose-kurti", name: "Rose Kurti", sku: "MM-K1", audience: "women", category: cat._id, status: "active",
        pricePaise: 100000, mrpPaise: 100000, images: [{ url: "https://img.example/x.jpg" }],
        variants: [{ sku: SKU, size: "M", color: { name: "Rose" }, pricePaise: 100000, mrpPaise: 100000, stock: 10 }],
      })
    )._id,
  );
}, 240_000);

beforeEach(async () => {
  rz.reset();
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => rz.handle(String(input), init)));
  await Promise.all([Cart, Order, Payment, CouponRedemption, InventoryMovement, WebhookEvent, Coupon].map((m) => (m as typeof Order).deleteMany({})));
  await Coupon.create({ code: "FLAT100", type: "flat", value: 10000, startsAt: new Date(Date.now() - 86_400_000) });
  await Product.updateOne({ _id: productId }, { $set: { "variants.0.stock": 10, "variants.0.reserved": 0, soldCount: 0, inStock: true } });
  resetRateLimits();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await disconnectFromDatabase();
  await rs?.stop();
  resetEnvCache();
});

/* ---------- B-01 ---------- */

describe("B-01: cancelling an order that was paid after its reservation expired", () => {
  async function latePaid(opts: { couponCode?: string } = {}) {
    const o = await placeOrder(opts);
    const rzpOrder = await startPayment(o);
    expect(await stock()).toEqual({ stock: 10, reserved: 2, sold: 0 });
    await expire(o);
    expect(await stock()).toEqual({ stock: 10, reserved: 0, sold: 0 });
    const payment = rz.pay(rzpOrder);
    expect((await captured(payment)).body.data.status).toBe("late_paid");
    expect(await stock()).toEqual({ stock: 8, reserved: 0, sold: 2 });
    return { o, payment };
  }

  it("restores stock and sold count exactly once, with matching ledger rows", async () => {
    const { o, payment } = await latePaid();
    expect(await orderDoc(o)).toMatchObject({ status: "placed", paymentStatus: "captured", stockReleased: false });

    expect((await setStatus(o, "Cancelled")).status).toBe(200);
    expect(await stock()).toEqual({ stock: 10, reserved: 0, sold: 0 });
    expect(await ledger(o)).toEqual([
      ["reservation", 0, 2],
      ["release", 0, -2],
      ["sale", -2, 0],
      ["return", 2, 0],
    ]);
    expect(await ledgerStockChange()).toBe(0);

    // Cancelling again, in bulk, or replaying the payment never restores it twice.
    expect((await setStatus(o, "Cancelled")).status).toBe(409);
    await call(bulkRoute(req("/api/v1/admin/orders/bulk-status", { body: { ids: [o.id], status: "Delivered" }, jar: admin }), ctx()));
    expect((await captured(payment)).body.data.status).toBe("already_paid");
    expect(await stock()).toEqual({ stock: 10, reserved: 0, sold: 0 });
    expect(await InventoryMovement.countDocuments({ type: "return" })).toBe(1);

    // Cancelling is not a refund: payment and history are kept.
    const doc = await orderDoc(o);
    expect(doc).toMatchObject({ status: "cancelled", paymentStatus: "captured", totalPaise: 200000 });
    expect(doc.statusHistory.map((h) => h.status)).toEqual(["pending_payment", "expired", "placed", "cancelled"]);
    expect((await paymentDoc(payment.id)).status).toBe("captured");
  });

  it("simultaneous cancellations return the units once", async () => {
    const { o } = await latePaid();
    const results = await Promise.all([setStatus(o, "Cancelled"), setStatus(o, "Cancelled"), setStatus(o, "Cancelled")]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(await stock()).toEqual({ stock: 10, reserved: 0, sold: 0 });
    expect(await InventoryMovement.countDocuments({ type: "return" })).toBe(1);
  });

  it("also works after the order has moved forward", async () => {
    const { o } = await latePaid();
    expect((await setStatus(o, "Processing")).status).toBe(200);
    expect((await setStatus(o, "Packed")).status).toBe(200);
    expect(await stock()).toEqual({ stock: 8, reserved: 0, sold: 2 });
    expect((await setStatus(o, "Cancelled")).status).toBe(200);
    expect(await stock()).toEqual({ stock: 10, reserved: 0, sold: 0 });
  });

  it("covers orders paid late before this fix, which still say their stock was released", async () => {
    const { o } = await latePaid();
    await Order.updateOne({ orderNumber: o.id }, { $set: { stockReleased: true } }); // the old stored shape
    expect((await setStatus(o, "Cancelled")).status).toBe(200);
    expect((await setStatus(o, "Cancelled")).status).toBe(409);
    expect(await stock()).toEqual({ stock: 10, reserved: 0, sold: 0 });
    expect(await InventoryMovement.countDocuments({ type: "return" })).toBe(1);
  });

  it("leaves another shopper's reservation and the coupon count alone", async () => {
    const { o } = await latePaid({ couponCode: "FLAT100" });
    await placeOrder({ quantity: 3 });
    expect(await stock()).toEqual({ stock: 8, reserved: 3, sold: 2 });
    const uses = (await Coupon.findOne({ code: "FLAT100" }).lean())!.usageCount;
    expect((await setStatus(o, "Cancelled")).status).toBe(200);
    expect(await stock()).toEqual({ stock: 10, reserved: 3, sold: 0 });
    expect((await Coupon.findOne({ code: "FLAT100" }).lean())!.usageCount).toBe(uses);
  });

  it("returns nothing when the late payment couldn't be fulfilled, and normal orders are unchanged", async () => {
    const o = await placeOrder();
    const rzpOrder = await startPayment(o);
    await expire(o);
    await Product.updateOne({ _id: productId }, { $set: { "variants.0.stock": 1 } }); // sold elsewhere meanwhile
    expect((await captured(rz.pay(rzpOrder))).body.data.status).toBe("late_unfulfillable");
    expect((await setStatus(o, "Cancelled")).status).toBe(409);
    expect(await orderDoc(o)).toMatchObject({ status: "expired", stockReleased: true });
    expect(await stock()).toEqual({ stock: 1, reserved: 0, sold: 0 });
    expect(await InventoryMovement.countDocuments({ type: { $in: ["sale", "return"] } })).toBe(0);

    await Product.updateOne({ _id: productId }, { $set: { "variants.0.stock": 10 } });
    const normal = await placeOrder();
    await captured(rz.pay(await startPayment(normal)));
    expect((await setStatus(normal, "Cancelled")).status).toBe(200);
    expect(await stock()).toEqual({ stock: 10, reserved: 0, sold: 0 });
    expect((await ledger(normal)).map(([type]) => type)).toEqual(["reservation", "sale", "return"]);
  });
});

/* ---------- B-02 ---------- */

describe("B-02: refunding a duplicate payment", () => {
  /** Two attempts, both captured. `first` is which attempt's payment arrives first (and pays the order). */
  async function paidTwice(first: 1 | 2 = 1) {
    const o = await placeOrder();
    const attempt1 = await startPayment(o);
    const attempt2 = await retryPayment(o);
    expect(attempt2).not.toBe(attempt1);
    const pays = [rz.pay(attempt1), rz.pay(attempt2)];
    const [original, extra] = first === 1 ? pays : [pays[1], pays[0]];
    expect((await captured(original)).body.data.status).toBe("paid");
    expect((await captured(extra)).body.data.status).toBe("duplicate");
    expect(await stock()).toEqual({ stock: 8, reserved: 0, sold: 2 });
    return { o, original, extra, originalId: String((await paymentDoc(original.id))._id), extraId: String((await paymentDoc(extra.id))._id) };
  }

  const expectOrderUntouched = async (o: Placed, original: Rec) => {
    expect(await orderDoc(o)).toMatchObject({ status: "placed", paymentStatus: "captured", refundedPaise: 0, razorpayPaymentId: original.id, totalPaise: 200000 });
    expect(await paymentDoc(original.id)).toMatchObject({ status: "captured", refundedPaise: 0, refunds: [] });
  };

  it.each([1, 2] as const)("keeps the order paid and fulfillable (attempt %i paid first)", async (first) => {
    const { o, original, extra, extraId, originalId } = await paidTwice(first);
    const r = await adminRefund(extraId);
    expect(r.status, r.body.message).toBe(200);

    await expectOrderUntouched(o, original);
    // The duplicate keeps its own refund history.
    const dup = await paymentDoc(extra.id);
    expect(dup).toMatchObject({ status: "refunded", refundedPaise: 200000 });
    expect(dup.refunds).toMatchObject([{ amountPaise: 200000, status: "processed", reason: "Integrity test", source: "admin" }]);
    expect((await paymentDetail(extraId)).refunds).toHaveLength(1);
    expect((await paymentDetail(originalId)).refundable).toBe(2000);

    const view = await adminOrder(o);
    expect(view.order).toMatchObject({ paymentStatus: "captured", refunded: 0 });
    expect(view.order.allowedTransitions).toEqual(["Confirmed", "Processing", "Shipped", "Cancelled"]);
    expect((await setStatus(o, "Processing")).status).toBe(200);
    expect(await stock()).toEqual({ stock: 8, reserved: 0, sold: 2 }); // refunding moved no stock
    expect(await InventoryMovement.countDocuments({ type: "sale" })).toBe(1);
  });

  it("partial, webhook-reported and replayed refunds of the duplicate never touch the order", async () => {
    const { o, original, extra, extraId } = await paidTwice();
    expect((await adminRefund(extraId, { amountPaise: 50000 })).status).toBe(200);
    await expectOrderUntouched(o, original);

    // A refund made in the Razorpay Dashboard arrives only as a webhook — then again.
    const dashboard = { id: "rfnd_DashboardDup01", payment_id: extra.id, amount: 150000, currency: "INR" };
    rz.refunds.set(dashboard.id, { ...dashboard, status: "processed" });
    expect((await refundEvent("processed", dashboard, "processed")).body.data.status).toBe("recorded");
    expect((await refundEvent("processed", dashboard, "processed")).body.data.status).toBe("unchanged");
    await expectOrderUntouched(o, original);
    const dup = await paymentDoc(extra.id);
    expect(dup).toMatchObject({ status: "refunded", refundedPaise: 200000 });
    expect(dup.refunds.map((x) => x.amountPaise)).toEqual([50000, 150000]);
  });

  it("refunding the original payment still updates the order", async () => {
    const { o, extra, originalId, extraId } = await paidTwice();
    await adminRefund(extraId);
    expect((await adminRefund(originalId, { amountPaise: 50000 })).status).toBe(200);
    expect(await orderDoc(o)).toMatchObject({ paymentStatus: "partially_refunded", refundedPaise: 50000 });
    expect((await adminRefund(originalId)).status).toBe(200);
    expect(await orderDoc(o)).toMatchObject({ paymentStatus: "refunded", refundedPaise: 200000 });
    expect((await paymentDoc(extra.id)).refunds).toHaveLength(1);
  });
});

/* ---------- B-04 ---------- */

describe("B-04: late refund updates", () => {
  async function paid() {
    const o = await placeOrder();
    const payment = rz.pay(await startPayment(o));
    await captured(payment);
    return { o, payment, paymentId: String((await paymentDoc(payment.id))._id) };
  }
  const refundRow = async (razorpayPaymentId: string) => (await paymentDoc(razorpayPaymentId)).refunds[0];

  it("a processed refund stays processed when older pending events arrive", async () => {
    const { o, payment, paymentId } = await paid();
    rz.refundStatus = "pending";
    expect((await adminRefund(paymentId)).status).toBe(200);
    const refund = [...rz.refunds.values()][0];
    expect((await refundRow(payment.id)).status).toBe("pending");
    expect((await refundEvent("processed", refund, "processed")).body.data.status).toBe("recorded");
    const settled = await refundRow(payment.id);
    expect(settled.status).toBe("processed");

    for (const type of ["created", "processed", "created"]) {
      const r = await refundEvent(type, refund, "pending"); // new event IDs, so de-duplication doesn't hide them
      expect([r.status, r.body.data.status]).toEqual([200, "unchanged"]);
    }
    // A status sync that reads a stale "pending" is ignored too.
    expect((await syncRefund(paymentId, refund.id)).status).toBe(200);

    const after = await paymentDoc(payment.id);
    expect(after.refunds).toHaveLength(1);
    expect(after.refunds[0]).toMatchObject({ status: "processed", amountPaise: 200000, processedAt: settled.processedAt });
    expect(after).toMatchObject({ status: "refunded", refundedPaise: 200000 });
    expect(await orderDoc(o)).toMatchObject({ paymentStatus: "refunded", refundedPaise: 200000 });
  });

  it("a failed refund never returns to pending, so it stays uncounted", async () => {
    const { o, payment, paymentId } = await paid();
    rz.refundStatus = "pending";
    await adminRefund(paymentId);
    const refund = [...rz.refunds.values()][0];
    await refundEvent("failed", refund, "failed");
    expect((await refundEvent("created", refund, "pending")).body.data.status).toBe("unchanged");
    expect((await refundRow(payment.id)).status).toBe("failed");
    expect(await paymentDoc(payment.id)).toMatchObject({ status: "captured", refundedPaise: 0 });
    expect(await orderDoc(o)).toMatchObject({ paymentStatus: "captured", refundedPaise: 0 });
  });

  it("keeps the settled status when the webhook beats our own API reply", async () => {
    const { payment, paymentId } = await paid();
    rz.refundStatus = "pending";
    rz.beforeRefundReply = async (refund) => {
      expect((await refundEvent("processed", refund, "processed")).body.data.status).toBe("recorded");
    };
    const r = await adminRefund(paymentId); // the reply still says "pending"
    expect(r.status, r.body.message).toBe(200);
    const after = await paymentDoc(payment.id);
    expect(after.refunds).toHaveLength(1);
    expect(after.refunds[0].status).toBe("processed");
  });

  it("pending and processed delivered at the same moment end processed", async () => {
    for (let i = 0; i < 4; i++) {
      const { payment } = await paid();
      const refund = { id: `rfnd_Race${randomBytes(5).toString("hex")}`, payment_id: payment.id, amount: 200000, currency: "INR" };
      const results = await Promise.all([refundEvent("processed", refund, "processed"), refundEvent("created", refund, "pending")]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      const after = await paymentDoc(payment.id);
      expect(after.refunds).toHaveLength(1);
      expect(after.refunds[0].status).toBe("processed");
    }
  });

  it("still allows the forward moves: pending → processed or failed", async () => {
    for (const final of ["processed", "failed"]) {
      const { payment, paymentId } = await paid();
      rz.refundStatus = "pending";
      await adminRefund(paymentId);
      const refund = [...rz.refunds.values()].find((x) => x.payment_id === payment.id)!;
      refund.status = final;
      expect((await syncRefund(paymentId, refund.id)).status).toBe(200);
      expect((await refundRow(payment.id)).status).toBe(final);
    }
  });
});
