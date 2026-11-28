import { createHmac, randomBytes } from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { NextRequest, type NextResponse } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as adminLogin } from "@/app/api/v1/admin/auth/login/route";
import { PATCH as statusRoute } from "@/app/api/v1/admin/orders/[id]/status/route";
import { POST as refundRoute } from "@/app/api/v1/admin/payments/[id]/refunds/route";
import { POST as addLine } from "@/app/api/v1/cart/items/route";
import { POST as placeRoute } from "@/app/api/v1/checkout/orders/route";
import { GET as expireRoute } from "@/app/api/v1/cron/expire-orders/route";
import { POST as retryRoute } from "@/app/api/v1/payments/[orderId]/retry/route";
import { POST as createRoute } from "@/app/api/v1/payments/razorpay/create/route";
import { POST as verifyRoute } from "@/app/api/v1/payments/razorpay/verify/route";
import { POST as webhookRoute } from "@/app/api/v1/payments/razorpay/webhook/route";
import type { RazorpayPayment } from "@/lib/razorpay/server";
import { hashPassword } from "@/server/auth/password";
import { DEFAULT_ROLE_PERMISSIONS } from "@/server/auth/permissions";
import { resetEnvCache } from "@/server/config/env";
import { connectToDatabase, disconnectFromDatabase } from "@/server/db/connect";
import * as models from "@/server/models";
import { Admin, Cart, Category, Coupon, CouponRedemption, InventoryMovement, Order, Payment, Product, Role, WebhookEvent } from "@/server/models";
import { resetRateLimits } from "@/server/security/rate-limit";
import { completePayment, reconcileOrder } from "@/server/services/payment.service";

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }));

/**
 * Payment idempotency: once a payment is recorded, replaying it — in any refund state, through any
 * route — changes nothing, and any other captured payment is flagged as a duplicate without
 * touching stock. Real API routes, an in-memory replica set and a fake Razorpay; no real money.
 */

const KEY_ID = "rzp_test_Replay123456";
const KEY_SECRET = "replay-key-secret";
const WEBHOOK_SECRET = "replay-webhook-secret";
const ORIGIN = "http://localhost:3000";
const PW = "Correct-horse-42";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>;
const rid = (p: string) => `${p}_${randomBytes(7).toString("hex")}`;

/* ---------- Fake Razorpay ---------- */

const rz = {
  orders: new Map<string, Rec>(),
  payments: new Map<string, Rec>(),
  refunds: new Map<string, Rec>(),
  captures: [] as string[],
  reset() {
    this.orders.clear();
    this.payments.clear();
    this.refunds.clear();
    this.captures = [];
  },
  pay(orderId: string, status: "captured" | "authorized" = "captured") {
    const o = this.orders.get(orderId)!;
    const p = { id: rid("pay"), order_id: orderId, amount: o.amount, currency: "INR", status: status as string, method: "upi", international: false, captured: status === "captured", fee: 0, tax: 0 };
    this.payments.set(p.id, p);
    return { ...p }; // a snapshot, like a webhook payload
  },
  refunded(paymentId: string) {
    return [...this.refunds.values()].filter((r) => r.payment_id === paymentId && r.status !== "failed").reduce((s, r) => s + r.amount, 0);
  },
  /** As Razorpay reports it: a fully refunded payment's status becomes "refunded". */
  view(paymentId: string) {
    const p = this.payments.get(paymentId)!;
    const amount_refunded = this.refunded(paymentId);
    return { ...p, amount_refunded, status: amount_refunded >= p.amount ? "refunded" : p.status };
  },
  handle(url: string, init: RequestInit = {}): Response {
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
    if (method === "GET" && (m = path.match(/^\/orders\/([^/]+)\/payments$/))) return json({ items: [...this.payments.values()].filter((p) => p.order_id === m![1]).map((p) => this.view(p.id)) });
    if (method === "GET" && (m = path.match(/^\/payments\/([^/]+)$/))) return json(this.view(m[1]));
    if (method === "POST" && (m = path.match(/^\/payments\/([^/]+)\/capture$/))) {
      this.captures.push(m[1]);
      Object.assign(this.payments.get(m[1])!, { status: "captured", captured: true });
      return json(this.view(m[1]));
    }
    if (method === "POST" && (m = path.match(/^\/payments\/([^/]+)\/refund$/))) {
      const refund = { id: `rfnd_${randomBytes(7).toString("hex")}`, amount: body.amount, currency: "INR", payment_id: m[1], status: "processed", notes: body.notes };
      this.refunds.set(refund.id, refund);
      return json(refund);
    }
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
  seq += 1;
  const headers: Record<string, string> = { "x-forwarded-for": `10.8.${Math.floor(seq / 250) % 250}.${seq % 250}`, ...init.headers };
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
}

/** A guest checkout of two units (₹1,000 each) with a ₹100 coupon. */
async function placeOrder(): Promise<Placed> {
  const jar: Jar = {};
  Object.assign(jar, cookiesOf(await addLine(req("/api/v1/cart/items", { body: { productId: "p001", size: "M", color: "Rose", quantity: 2 }, jar }), ctx())));
  const r = await call(
    placeRoute(
      req("/api/v1/checkout/orders", {
        jar,
        body: {
          source: { type: "cart" },
          couponCode: "FLAT100",
          customer: { fullName: "Anitha Menon", email: "anitha@example.com", mobile: "9876543210" },
          address: { house: "12 Rose Villa", street: "MG Road", city: "Kochi", district: "Ernakulam", state: "Kerala", pincode: "682001" },
          paymentMethod: "upi",
          idempotencyKey: `replay-${Date.now()}-${++seq}-abcdef`,
          expectedTotalPaise: 190000,
        },
      }),
      ctx(),
    ),
  );
  expect(r.status, r.body.message).toBe(201);
  return { id: r.body.data.order.id, token: r.body.data.accessToken };
}

const guest = (o: Placed) => ({ "x-order-token": o.token });
const startPayment = async (o: Placed) => (await call(createRoute(req("/api/v1/payments/razorpay/create", { body: { orderId: o.id }, headers: guest(o) }), ctx()))).body.data.razorpayOrderId as string;
const retryPayment = async (o: Placed) => (await call(retryRoute(req(`/api/v1/payments/${o.id}/retry`, { headers: guest(o) }), ctx({ orderId: o.id })))).body.data.razorpayOrderId as string;
const checkoutVerify = (o: Placed, p: Rec) =>
  call(
    verifyRoute(
      req("/api/v1/payments/razorpay/verify", {
        headers: guest(o),
        body: { orderId: o.id, razorpay_order_id: p.order_id, razorpay_payment_id: p.id, razorpay_signature: createHmac("sha256", KEY_SECRET).update(`${p.order_id}|${p.id}`).digest("hex") },
      }),
      ctx(),
    ),
  );

function webhook(event: string, payload: Rec, eventId = rid("evt")) {
  const raw = JSON.stringify({ entity: "event", event, payload, created_at: 1 });
  const signature = createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
  return call(webhookRoute(req("/api/v1/payments/razorpay/webhook", { raw, origin: null, headers: { "x-razorpay-signature": signature, "x-razorpay-event-id": eventId } }), ctx()));
}
const paymentEvent = (event: string, p: Rec, eventId?: string) => webhook(event, { payment: { entity: p } }, eventId);
const refundEvent = (refund: Rec, type = "processed", eventId?: string) => webhook(`refund.${type}`, { refund: { entity: refund } }, eventId);

const cron = () => call(expireRoute(req("/api/v1/cron/expire-orders", { method: "GET", headers: { authorization: `Bearer ${"c".repeat(32)}` } }), ctx()));
async function expire(o: Placed) {
  await Order.updateOne({ orderNumber: o.id }, { $set: { reservationExpiresAt: new Date(Date.now() - 1000) } });
  await cron();
  expect((await orderDoc(o)).status).toBe("expired");
}

const orderDoc = async (o: Placed) => (await Order.findOne({ orderNumber: o.id }).lean())!;
const paymentDoc = async (razorpayPaymentId: string) => (await Payment.findOne({ razorpayPaymentId }).lean())!;
const stock = async () => {
  const p = (await Product.findById(productId, { variants: 1, soldCount: 1 }).lean())!;
  return { stock: p.variants[0].stock, reserved: p.variants[0].reserved, sold: p.soldCount };
};
const sales = () => InventoryMovement.countDocuments({ type: "sale" });

/** Everything a replay must leave exactly as it was: order, payments, stock, ledger and coupon. */
async function snapshot(o: Placed) {
  const order = await orderDoc(o);
  const strip = (doc: Rec) => {
    const { updatedAt: _ignored, paymentLockUntil: _lock, ...rest } = doc;
    void _ignored;
    void _lock;
    return rest;
  };
  return JSON.parse(
    JSON.stringify({
      order: strip(order),
      payments: (await Payment.find({ order: order._id }).sort({ attempt: 1 }).lean()).map(strip),
      stock: await stock(),
      ledger: await InventoryMovement.find().sort({ createdAt: 1, _id: 1 }).lean(),
      coupon: (await Coupon.findOne({ code: "FLAT100" }).lean())!.usageCount,
      redemptions: await CouponRedemption.find().lean(),
    }),
  );
}

async function adminRefund(razorpayPaymentId: string, amountPaise?: number) {
  const id = String((await paymentDoc(razorpayPaymentId))._id);
  const r = await call(
    refundRoute(req(`/api/v1/admin/payments/${id}/refunds`, { jar: admin, body: { reason: "Replay test", idempotencyKey: `refund-${randomBytes(12).toString("hex")}`, amountPaise } }), ctx({ id })),
  );
  expect(r.status, r.body.message).toBe(200);
  return [...rz.refunds.values()].at(-1)!;
}
const setStatus = (o: Placed, status: string) => call(statusRoute(req(`/api/v1/admin/orders/${o.id}/status`, { method: "PATCH", body: { status }, jar: admin }), ctx({ id: o.id })));

type RefundState = "captured" | "partially_refunded" | "refunded";
const STATES: RefundState[] = ["captured", "partially_refunded", "refunded"];

async function refundTo(state: RefundState, paymentId: string) {
  if (state !== "captured") await adminRefund(paymentId, state === "partially_refunded" ? 50000 : undefined);
}

/** An order paid through the checkout callback, then put into the given refund state. */
async function paidOrder(state: RefundState) {
  const o = await placeOrder();
  const p = rz.pay(await startPayment(o));
  expect((await checkoutVerify(o, p)).body.data.result).toBe("paid");
  await refundTo(state, p.id);
  expect((await orderDoc(o)).paymentStatus).toBe(state);
  return { o, p };
}

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  vi.stubEnv("MONGODB_URI", rs.getUri());
  vi.stubEnv("MONGODB_DB_NAME", "mm-replay-test");
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
        variants: [{ sku: "MM-K1-M-ROSE", size: "M", color: { name: "Rose" }, pricePaise: 100000, mrpPaise: 100000, stock: 10 }],
      })
    )._id,
  );
}, 240_000);

beforeEach(async () => {
  rz.reset();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => rz.handle(String(input), init)));
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

/* ---------- Replays of the original payment ---------- */

describe.each(STATES)("replaying the original payment when the order is %s", (state) => {
  async function check(replay: (o: Placed, p: Rec) => Promise<unknown>) {
    const { o, p } = await paidOrder(state);
    const before = await snapshot(o);
    await replay(o, p);
    expect(await snapshot(o)).toEqual(before);
    expect(await stock()).toEqual({ stock: 8, reserved: 0, sold: 2 });
    expect(await sales()).toBe(1);
    expect(rz.captures).toEqual([]);
  }

  it("payment.captured — a new event ID, then the same event ID again", () =>
    check(async (_o, p) => {
      const eventId = rid("evt");
      const first = await paymentEvent("payment.captured", p, eventId);
      expect([first.status, first.body.data.status]).toEqual([200, "already_paid"]);
      expect((await paymentEvent("payment.captured", p, eventId)).body.data.duplicate).toBe(true);
      expect((await paymentEvent("payment.captured", p)).body.data.status).toBe("already_paid");
    }));

  it("order.paid", () =>
    check(async (_o, p) => {
      expect((await webhook("order.paid", { payment: { entity: p }, order: { entity: rz.orders.get(p.order_id) } })).body.data.status).toBe("already_paid");
    }));

  it("a stale payment.authorized never captures anything", () =>
    check(async (_o, p) => {
      expect((await paymentEvent("payment.authorized", { ...p, status: "authorized", captured: false })).status).toBe(200);
    }));

  it("repeated checkout verification reports the payment as paid", () =>
    check(async (o, p) => {
      for (let i = 0; i < 3; i++) {
        const r = await checkoutVerify(o, p);
        expect([r.status, r.body.data.result]).toEqual([200, "paid"]);
        expect(r.body.data.order.paymentState).toBe(state === "captured" ? "paid" : "refunded");
      }
    }));

  it("a direct completion and reconciliation", () =>
    check(async (o, p) => {
      expect(await completePayment(p as unknown as RazorpayPayment, "reconcile")).toBe("already_paid");
      expect(await reconcileOrder((await orderDoc(o))._id)).toBe("paid");
    }));

  it("concurrent webhooks and checkout verifications", () =>
    check(async (o, p) => {
      const results = await Promise.all([
        paymentEvent("payment.captured", p),
        paymentEvent("payment.captured", p),
        webhook("order.paid", { payment: { entity: p } }),
        checkoutVerify(o, p),
        checkoutVerify(o, p),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    }));

  it("a late payment.failed from an earlier try keeps the payment's history", () =>
    check(async (_o, p) => {
      const failed = { ...p, id: rid("pay"), status: "failed", captured: false, error_code: "BAD_REQUEST_ERROR", error_description: "Declined" };
      expect((await paymentEvent("payment.failed", failed)).body.data.status).toBe("ignored");
    }));
});

describe("replays after the order's life has moved on", () => {
  it("a cancelled and refunded order is not revived or sold again", async () => {
    const { o, p } = await paidOrder("captured");
    expect((await setStatus(o, "Cancelled")).status).toBe(200);
    await adminRefund(p.id);
    const before = await snapshot(o);
    await paymentEvent("payment.captured", p);
    await checkoutVerify(o, p);
    expect(await snapshot(o)).toEqual(before);
    expect(await orderDoc(o)).toMatchObject({ status: "cancelled", paymentStatus: "refunded", refundedPaise: 190000 });
    expect(await stock()).toEqual({ stock: 10, reserved: 0, sold: 0 });
  });

  it("a late-paid order that was refunded is not sold a second time", async () => {
    const o = await placeOrder();
    const rzpOrder = await startPayment(o);
    await expire(o);
    const p = rz.pay(rzpOrder);
    expect((await paymentEvent("payment.captured", p)).body.data.status).toBe("late_paid");
    await adminRefund(p.id, 50000);
    const before = await snapshot(o);
    expect((await paymentEvent("payment.captured", p)).body.data.status).toBe("already_paid");
    expect(await snapshot(o)).toEqual(before);
    expect(await sales()).toBe(1);
  });

  it("an unfulfillable, refunded payment is not sold when stock returns", async () => {
    const o = await placeOrder();
    const rzpOrder = await startPayment(o);
    await expire(o);
    await Product.updateOne({ _id: productId }, { $set: { "variants.0.stock": 1 } });
    const p = rz.pay(rzpOrder);
    expect((await paymentEvent("payment.captured", p)).body.data.status).toBe("late_unfulfillable");
    await adminRefund(p.id);
    await Product.updateOne({ _id: productId }, { $set: { "variants.0.stock": 10 } }); // restocked later
    const before = await snapshot(o);
    expect((await paymentEvent("payment.captured", p)).body.data.status).toBe("already_paid");
    expect(await snapshot(o)).toEqual(before);
    expect(await orderDoc(o)).toMatchObject({ status: "expired", paymentStatus: "refunded" });
    expect(await sales()).toBe(0);
  });
});

/* ---------- First deliveries and ordering ---------- */

describe("concurrent first deliveries", () => {
  it("webhooks and checkout verification arriving together sell the stock once", async () => {
    for (let i = 0; i < 4; i++) {
      await Promise.all([InventoryMovement.deleteMany({}), Product.updateOne({ _id: productId }, { $set: { "variants.0.stock": 10, "variants.0.reserved": 0, soldCount: 0 } })]);
      const o = await placeOrder();
      const p = rz.pay(await startPayment(o));
      const results = await Promise.all([paymentEvent("payment.captured", p), webhook("order.paid", { payment: { entity: p } }), checkoutVerify(o, p), paymentEvent("payment.captured", p)]);
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
      expect(await stock()).toEqual({ stock: 8, reserved: 0, sold: 2 });
      expect(await sales()).toBe(1);
      expect(await orderDoc(o)).toMatchObject({ status: "placed", paymentStatus: "captured", razorpayPaymentId: p.id });
    }
  });
});

describe("refund webhook before a delayed payment webhook", () => {
  it("after checkout already recorded the payment, the delayed webhook changes nothing", async () => {
    const { o, p } = await paidOrder("captured");
    const dashboard = { id: "rfnd_BeforeHook01", payment_id: p.id, amount: 190000, currency: "INR", status: "processed" };
    rz.refunds.set(dashboard.id, dashboard);
    expect((await refundEvent(dashboard)).body.data.status).toBe("recorded");
    const before = await snapshot(o);
    expect((await paymentEvent("payment.captured", p)).body.data.status).toBe("already_paid");
    expect(await snapshot(o)).toEqual(before);
  });

  it("before the payment is known at all, the sale still happens exactly once", async () => {
    const o = await placeOrder();
    const p = rz.pay(await startPayment(o));
    const early = { id: "rfnd_TooEarly001", payment_id: p.id, amount: 50000, currency: "INR", status: "processed" };
    expect((await refundEvent(early, "created")).body.data.status).toBe("deferred"); // kept until the payment is known
    expect((await paymentEvent("payment.captured", p)).body.data.status).toBe("paid");
    // Applied as soon as the payment was recorded, with no later refund event needed.
    expect(await orderDoc(o)).toMatchObject({ paymentStatus: "partially_refunded", refundedPaise: 50000 });
    expect((await paymentDoc(p.id)).refunds.map((r) => [r.razorpayRefundId, r.amountPaise, r.status])).toEqual([[early.id, 50000, "processed"]]);
    await paymentEvent("payment.captured", p);
    expect(await sales()).toBe(1);
    // A later event for the same refund adds nothing; replaying the payment still changes nothing.
    expect((await refundEvent(early, "processed")).body.data.status).toBe("unchanged");
    const before = await snapshot(o);
    expect((await paymentEvent("payment.captured", p)).body.data.status).toBe("already_paid");
    expect(await snapshot(o)).toEqual(before);
    expect(await stock()).toEqual({ stock: 8, reserved: 0, sold: 2 });
  });

  it("a refund and a payment replay at the same moment leave the refund in place", async () => {
    for (let i = 0; i < 4; i++) {
      await Promise.all([InventoryMovement.deleteMany({}), Product.updateOne({ _id: productId }, { $set: { "variants.0.stock": 10, "variants.0.reserved": 0, soldCount: 0 } })]);
      const { o, p } = await paidOrder("captured");
      const refund = { id: `rfnd_Same${randomBytes(5).toString("hex")}`, payment_id: p.id, amount: 190000, currency: "INR", status: "processed" };
      await Promise.all([refundEvent(refund), paymentEvent("payment.captured", p), checkoutVerify(o, p)]);
      expect(await orderDoc(o)).toMatchObject({ paymentStatus: "refunded", refundedPaise: 190000 });
      expect((await paymentDoc(p.id)).status).toBe("refunded");
      expect(await sales()).toBe(1);
    }
  });
});

/* ---------- A different payment ---------- */

describe.each(STATES)("a different payment captured when the order is %s", (state) => {
  /** The order is paid by attempt 1; attempt 2 exists and its payment arrives afterwards. */
  async function withSecondAttempt() {
    const o = await placeOrder();
    const first = await startPayment(o);
    const second = await retryPayment(o);
    const p = rz.pay(first);
    expect((await paymentEvent("payment.captured", p)).body.data.status).toBe("paid");
    await refundTo(state, p.id);
    return { o, p, second };
  }

  async function expectOnlyFlagged(o: Placed, before: Rec, extraId: string) {
    const after = await snapshot(o);
    const { exception, ...order } = after.order;
    const { exception: _was, ...orderBefore } = before.order;
    void _was;
    expect(order).toEqual(orderBefore); // status, payment status, refund totals and history unchanged
    expect(exception).toMatchObject({ code: "DUPLICATE_PAYMENT" });
    expect(exception.message).toContain(extraId);
    expect(after.payments[0]).toEqual(before.payments[0]); // the original payment and its refunds
    expect([after.stock, after.ledger, after.coupon, after.redemptions]).toEqual([before.stock, before.ledger, before.coupon, before.redemptions]);
  }

  it("is recorded as a duplicate with no stock change, and replaying it changes nothing", async () => {
    const { o, second } = await withSecondAttempt();
    const before = await snapshot(o);
    const extra = rz.pay(second);
    const r = await paymentEvent("payment.captured", extra);
    expect([r.status, r.body.data.status]).toEqual([200, "duplicate"]);
    await expectOnlyFlagged(o, before, extra.id);
    expect(await paymentDoc(extra.id)).toMatchObject({ status: "captured", attempt: 2, refundedPaise: 0 });

    const flagged = await snapshot(o);
    const again = await Promise.all([paymentEvent("payment.captured", extra), webhook("order.paid", { payment: { entity: extra } }), checkoutVerify(o, extra)]);
    expect(again.map((x) => x.status)).toEqual([200, 200, 200]);
    expect(await snapshot(o)).toEqual(flagged);
  });

  it("arriving through checkout verification is handled the same way", async () => {
    const { o, second } = await withSecondAttempt();
    const before = await snapshot(o);
    const extra = rz.pay(second);
    expect((await checkoutVerify(o, extra)).status).toBe(200);
    await expectOnlyFlagged(o, before, extra.id);
  });

  it("many simultaneous deliveries record it once and sell nothing", async () => {
    const { o, second } = await withSecondAttempt();
    const before = await snapshot(o);
    const extra = rz.pay(second);
    await Promise.all([paymentEvent("payment.captured", extra), paymentEvent("payment.captured", extra), checkoutVerify(o, extra), webhook("order.paid", { payment: { entity: extra } })]);
    await expectOnlyFlagged(o, before, extra.id);
    expect(await Payment.countDocuments({ razorpayPaymentId: extra.id })).toBe(1);
  });

  it("that is only authorized is never captured, by webhook or checkout", async () => {
    const { o, second } = await withSecondAttempt();
    const before = await snapshot(o);
    const extra = rz.pay(second, "authorized");
    expect((await paymentEvent("payment.authorized", extra)).status).toBe(200);
    expect((await checkoutVerify(o, extra)).status).toBe(200);
    expect(rz.captures).toEqual([]);
    expect(await snapshot(o)).toEqual(before);
  });

  it("on the same Razorpay order is flagged and sells nothing", async () => {
    const { o, p } = await paidOrder(state);
    const before = await snapshot(o);
    const extra = rz.pay(p.order_id);
    expect((await paymentEvent("payment.captured", extra)).body.data.status).toBe("duplicate");
    await expectOnlyFlagged(o, before, extra.id);
    const flagged = await snapshot(o);
    await paymentEvent("payment.captured", extra);
    expect(await snapshot(o)).toEqual(flagged);
  });
});

describe("two different payments at the same moment", () => {
  it("one pays the order, the other is a duplicate; stock is sold once", async () => {
    for (let i = 0; i < 4; i++) {
      await Promise.all([InventoryMovement.deleteMany({}), Product.updateOne({ _id: productId }, { $set: { "variants.0.stock": 10, "variants.0.reserved": 0, soldCount: 0 } })]);
      const o = await placeOrder();
      const first = await startPayment(o);
      const second = await retryPayment(o);
      const [a, b] = [rz.pay(first), rz.pay(second)];
      const results = await Promise.all([paymentEvent("payment.captured", a), paymentEvent("payment.captured", b)]);
      expect(results.map((r) => r.body.data.status).sort()).toEqual(["duplicate", "paid"]);
      expect(await stock()).toEqual({ stock: 8, reserved: 0, sold: 2 });
      expect(await sales()).toBe(1);
    }
  });
});
