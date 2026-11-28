import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { NextRequest, type NextResponse } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as addLine } from "@/app/api/v1/cart/items/route";
import { POST as placeRoute } from "@/app/api/v1/checkout/orders/route";
import { GET as cronRoute, maxDuration } from "@/app/api/v1/cron/expire-orders/route";
import { POST as createRoute } from "@/app/api/v1/payments/razorpay/create/route";
import { POST as webhookRoute } from "@/app/api/v1/payments/razorpay/webhook/route";
import { resetEnvCache } from "@/server/config/env";
import { connectToDatabase, disconnectFromDatabase } from "@/server/db/connect";
import * as models from "@/server/models";
import { Cart, Category, Coupon, CouponRedemption, InventoryMovement, Order, Payment, Product, WebhookEvent } from "@/server/models";
import { resetRateLimits } from "@/server/security/rate-limit";
import { expireStaleOrders } from "@/server/services/order.service";
import { sweepDeferredRefunds } from "@/server/services/refund.service";

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }));

/**
 * The scheduled job: releasing expired unpaid orders and retrying saved refunds. Real API routes,
 * an in-memory replica set and a fake Razorpay — no real gateway call or money.
 */

const KEY_ID = "rzp_test_CronExpiry123";
const KEY_SECRET = "cron-key-secret";
const WEBHOOK_SECRET = "cron-webhook-secret";
const SECRET = "cron-secret-value-for-tests-0123456789";
const ORIGIN = "http://localhost:3000";
const BATCH = 100;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>;
const rid = (p: string) => `${p}_${randomBytes(7).toString("hex")}`;

/* ---------- Fake Razorpay ---------- */

const rz = {
  orders: new Map<string, Rec>(),
  payments: new Map<string, Rec>(),
  down: false,
  /** Seconds the clock moves on for each "payments of this order" lookup (a slow gateway). */
  slowness: 0,
  moneyCalls: [] as string[],
  reset() {
    this.orders.clear();
    this.payments.clear();
    this.down = false;
    this.slowness = 0;
    this.moneyCalls = [];
  },
  pay(orderId: string, status = "captured") {
    const o = this.orders.get(orderId)!;
    const p = { id: rid("pay"), order_id: orderId, amount: o.amount, currency: "INR", status, method: "upi", international: false, captured: status === "captured", fee: 0, tax: 0 };
    this.payments.set(p.id, p);
    return { ...p };
  },
  handle(url: string, init: RequestInit = {}): Response {
    if (!url.startsWith("https://api.razorpay.com/v1")) throw new Error(`Unexpected network call: ${url}`);
    const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
    const path = url.replace("https://api.razorpay.com/v1", "").split("?")[0];
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : {};
    let m: RegExpMatchArray | null;
    if (method === "POST" && /\/(capture|refund)$/.test(path)) this.moneyCalls.push(path);
    if (method === "POST" && path === "/orders") {
      const o = { id: rid("order"), amount: body.amount, currency: body.currency, receipt: body.receipt, notes: body.notes, status: "created" };
      this.orders.set(o.id, o);
      return json(o);
    }
    if (method === "GET" && (m = path.match(/^\/orders\/([^/]+)\/payments$/))) {
      clock += this.slowness * 1000;
      if (this.down) throw new TypeError("fetch failed");
      return json({ items: [...this.payments.values()].filter((p) => p.order_id === m![1]) });
    }
    return json({ error: { description: "not found" } }, 404);
  },
};

/* ---------- Harness ---------- */

type Jar = Record<string, string>;
const ctx = <P extends Record<string, string>>(params: P = {} as P) => ({ params: Promise.resolve(params) });
let rs: MongoMemoryReplSet;
let productId: string;
let seq = 0;
let clock = 0;
const realNow = Date.now.bind(Date);
const logs: string[] = [];

function req(path: string, init: { method?: string; body?: unknown; raw?: string; jar?: Jar; origin?: string | null; headers?: Record<string, string> } = {}) {
  seq += 1;
  const headers: Record<string, string> = { "x-forwarded-for": `10.11.${Math.floor(seq / 250) % 250}.${seq % 250}`, ...init.headers };
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

/** As Vercel Cron calls it: GET with `Authorization: Bearer <CRON_SECRET>`. */
const cron = (authorization: string | null = `Bearer ${SECRET}`) =>
  call(cronRoute(req("/api/v1/cron/expire-orders", { method: "GET", origin: null, headers: { "user-agent": "vercel-cron/1.0", ...(authorization === null ? {} : { authorization }) } }), ctx()));

interface Placed {
  id: string;
  token: string;
}

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
          idempotencyKey: `cron-${realNow()}-${++seq}-abcdef`,
          expectedTotalPaise: 190000,
        },
      }),
      ctx(),
    ),
  );
  expect(r.status, r.body.message).toBe(201);
  return { id: r.body.data.order.id, token: r.body.data.accessToken };
}

const startPayment = async (o: Placed) =>
  (await call(createRoute(req("/api/v1/payments/razorpay/create", { body: { orderId: o.id }, headers: { "x-order-token": o.token } }), ctx()))).body.data.razorpayOrderId as string;

function webhook(event: string, payload: Rec, eventId = rid("evt")) {
  const raw = JSON.stringify({ entity: "event", event, payload, created_at: 1 });
  const signature = createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
  return call(webhookRoute(req("/api/v1/payments/razorpay/webhook", { raw, origin: null, headers: { "x-razorpay-signature": signature, "x-razorpay-event-id": eventId } }), ctx()));
}
const captured = (p: Rec) => webhook("payment.captured", { payment: { entity: p } });
const refundOf = (paymentId: string, amount = 50000, status = "processed"): Rec => ({ id: `rfnd_${randomBytes(7).toString("hex")}`, amount, currency: "INR", payment_id: paymentId, status, notes: [] });
const refundHook = (refund: Rec, eventId = rid("evt")) => webhook(`refund.${refund.status === "pending" ? "created" : refund.status}`, { refund: { entity: refund } }, eventId);

const expireAt = (o: Placed, msAgo = 1000) => Order.updateOne({ orderNumber: o.id }, { $set: { reservationExpiresAt: new Date(Date.now() - msAgo) } });
const orderDoc = async (o: Placed) => (await Order.findOne({ orderNumber: o.id }).lean())!;
const stock = async () => {
  const p = (await Product.findById(productId, { variants: 1, soldCount: 1 }).lean())!;
  return { stock: p.variants[0].stock, reserved: p.variants[0].reserved, sold: p.soldCount };
};
const releases = () => InventoryMovement.countDocuments({ type: "release" });
const couponUses = async () => (await Coupon.findOne({ code: "FLAT100" }).lean())!.usageCount;
const goods = async () =>
  JSON.parse(JSON.stringify({ stock: await stock(), ledger: await InventoryMovement.find().sort({ createdAt: 1, _id: 1 }).lean(), coupon: await couponUses(), redemptions: await CouponRedemption.find().sort({ _id: 1 }).lean() }));

/**
 * Due orders written straight to the database (no stock held), for batch and queue tests. Their
 * order numbers start with `tag`.
 */
async function seedDue(count: number, tag: string, { minutesAgo = 60, attempts = 0 } = {}) {
  const docs = Array.from({ length: count }, (_, i) => ({
    orderNumber: `MM${tag}${String(i).padStart(4, "0")}`,
    user: null,
    customer: { fullName: "Bulk Buyer", email: "bulk@example.com", mobile: "9876543210" },
    shippingAddress: { house: "1", street: "s", city: "Kochi", district: "Ernakulam", state: "Kerala", pincode: "682001", country: "India" },
    items: [{ product: productId, variantSku: "MM-NONE", name: "x", slug: "x", unitPricePaise: 100, mrpPaise: 100, quantity: 1, lineTotalPaise: 100 }],
    subtotalPaise: 100, mrpTotalPaise: 100, discountPaise: 0, totalPaise: 100,
    status: "pending_payment", paymentStatus: "pending", stockReleased: false, paymentAttemptCount: attempts,
    reservationExpiresAt: new Date(Date.now() - minutesAgo * 60_000 + i),
  }));
  return Order.insertMany(docs);
}
const stillPending = (tag: string) => Order.countDocuments({ orderNumber: new RegExp(`^MM${tag}`), status: "pending_payment" });
/** Gives seeded orders a payment attempt, so the job has to ask Razorpay about them. */
async function giveAttempts(orders: { _id: unknown; orderNumber: string }[]) {
  await Payment.insertMany(orders.map((o) => ({ order: o._id, orderNumber: o.orderNumber, attempt: 1, mode: "test", razorpayOrderId: rid("order"), amountPaise: 100, status: "created" })));
}

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  vi.stubEnv("MONGODB_URI", rs.getUri());
  vi.stubEnv("MONGODB_DB_NAME", "mm-cron-test");
  await connectEnv();
  await connectToDatabase();
  for (const m of Object.values(models)) {
    await m.createCollection();
    await m.syncIndexes();
  }
  const cat = await Category.create({ slug: "kurtis", audience: "women", name: "Kurtis" });
  productId = String(
    (
      await Product.create({
        legacyId: "p001", slug: "rose-kurti", name: "Rose Kurti", sku: "MM-K1", audience: "women", category: cat._id, status: "active",
        pricePaise: 100000, mrpPaise: 100000, images: [{ url: "https://img.example/x.jpg" }],
        variants: [{ sku: "MM-K1-M-ROSE", size: "M", color: { name: "Rose" }, pricePaise: 100000, mrpPaise: 100000, stock: 20 }],
      })
    )._id,
  );
}, 240_000);

async function connectEnv() {
  vi.stubEnv("JWT_ACCESS_SECRET", "a".repeat(48));
  vi.stubEnv("JWT_REFRESH_SECRET", "r".repeat(48));
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("RAZORPAY_KEY_ID", KEY_ID);
  vi.stubEnv("RAZORPAY_KEY_SECRET", KEY_SECRET);
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", WEBHOOK_SECRET);
  vi.stubEnv("RAZORPAY_ALLOW_LIVE", "");
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  resetEnvCache();
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await connectEnv();
  rz.reset();
  clock = 0;
  vi.spyOn(Date, "now").mockImplementation(() => realNow() + clock);
  logs.length = 0;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, level).mockImplementation((...a) => void logs.push(a.map(String).join(" ")));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => rz.handle(String(input), init)));
  await Promise.all([Cart, Order, Payment, CouponRedemption, InventoryMovement, WebhookEvent, Coupon].map((m) => (m as typeof Order).deleteMany({})));
  await Coupon.create({ code: "FLAT100", type: "flat", value: 10000, startsAt: new Date(realNow() - 86_400_000) });
  await Product.updateOne({ _id: productId }, { $set: { "variants.0.stock": 20, "variants.0.reserved": 0, soldCount: 0, inStock: true } });
  resetRateLimits();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await disconnectFromDatabase();
  await rs?.stop();
  resetEnvCache();
});

/* ---------- Authentication ---------- */

describe("cron authentication", () => {
  /** An expired order and an applicable saved refund: both must be left alone when refused. */
  async function workWaiting() {
    // Both orders first: checkout itself sweeps expired holds, so age the due one afterwards.
    const due = await placeOrder();
    const paid = await placeOrder();
    const p = rz.pay(await startPayment(paid));
    await captured(p);
    await expireAt(due);
    await WebhookEvent.create({ provider: "razorpay", eventId: "evt_waiting", type: "refund.processed", payloadHash: "x", status: "deferred", refund: { refundId: "rfnd_Waiting0001", paymentId: p.id, amountPaise: 50000, currency: "INR", status: "processed" } });
    return { due, p };
  }
  async function expectUntouched(due: Placed, paymentId: string) {
    expect((await orderDoc(due)).status).toBe("pending_payment");
    expect(await releases()).toBe(0);
    expect((await Payment.findOne({ razorpayPaymentId: paymentId }).lean())!.refunds).toHaveLength(0);
    expect(logs.join("\n")).not.toContain(SECRET);
  }

  it.each([
    ["not set", ""],
    ["blank", "     "],
    ["shorter than 16 characters", "short-secret"],
  ])("CRON_SECRET %s: 503 and nothing runs", async (_label, value) => {
    const { due, p } = await workWaiting();
    vi.stubEnv("CRON_SECRET", value);
    resetEnvCache();
    for (const header of [null, "Bearer ", `Bearer ${value}`, "Bearer undefined", `Bearer ${SECRET}`]) {
      const r = await cron(header);
      expect([r.status, r.body.error?.code]).toEqual([503, "SERVICE_UNAVAILABLE"]);
      expect(JSON.stringify(r.body)).not.toMatch(/CRON_SECRET|secret/i);
    }
    await expectUntouched(due, p.id);
  });

  it.each([
    ["no header", null],
    ["an empty header", ""],
    ["a wrong secret of the same length", `Bearer ${"x".repeat(SECRET.length)}`],
    ["a prefix of the secret", `Bearer ${SECRET.slice(0, -1)}`],
    ["the secret plus extra", `Bearer ${SECRET}x`],
    ["the secret without Bearer", SECRET],
    ["another scheme", `Basic ${SECRET}`],
    ["a lower-case scheme", `bearer ${SECRET}`],
  ])("%s: 401 and nothing runs", async (_label, header) => {
    const { due, p } = await workWaiting();
    const r = await cron(header);
    expect([r.status, r.body.error?.code]).toEqual([401, "UNAUTHORIZED"]);
    expect(JSON.stringify(r.body)).not.toContain(SECRET);
    await expectUntouched(due, p.id);
  });

  it("is not unlocked by the query string, a cookie or Vercel's cron headers", async () => {
    const { due, p } = await workWaiting();
    const r = await call(
      cronRoute(req(`/api/v1/cron/expire-orders?secret=${SECRET}&authorization=Bearer%20${SECRET}`, { method: "GET", jar: { CRON_SECRET: SECRET }, headers: { "user-agent": "vercel-cron/1.0", "x-vercel-cron-schedule": "30 20 * * *", "x-vercel-cron": "1" } }), ctx()),
    );
    expect(r.status).toBe(401);
    await expectUntouched(due, p.id);
  });

  it("with the right secret does both jobs, answers in the same shape and logs no secret", async () => {
    const { due, p } = await workWaiting();
    const r = await cron();
    expect([r.status, r.body.message, r.body.data]).toEqual([200, "Expired unpaid orders", { checked: 1, expired: 1 }]);
    expect((await orderDoc(due)).status).toBe("expired");
    expect((await Payment.findOne({ razorpayPaymentId: p.id }).lean())!.refunds).toHaveLength(1);
    expect(logs.join("\n")).toContain("cron.expire_orders");
    expect(logs.join("\n")).not.toContain(SECRET);
  });
});

/* ---------- Expiry ---------- */

describe("expired orders", () => {
  it("releases an expired unpaid order's stock once, keeping its history", async () => {
    const o = await placeOrder();
    expect(await stock()).toEqual({ stock: 20, reserved: 2, sold: 0 });
    await expireAt(o);
    expect((await cron()).body.data).toEqual({ checked: 1, expired: 1 });
    expect(await stock()).toEqual({ stock: 20, reserved: 0, sold: 0 });
    const doc = await orderDoc(o);
    expect(doc).toMatchObject({ status: "expired", paymentStatus: "pending", stockReleased: true, totalPaise: 190000 });
    expect(doc.statusHistory.map((h) => h.status)).toEqual(["pending_payment", "expired"]);
    expect(await releases()).toBe(1);
    expect(await couponUses()).toBe(0); // the unpaid order gives its coupon use back, as before
    expect((await CouponRedemption.find().lean()).map((r) => r.status)).toEqual(["released"]);
  });

  it("leaves an unexpired order completely alone", async () => {
    const o = await placeOrder();
    const before = { order: await orderDoc(o), goods: await goods() };
    expect((await cron()).body.data).toEqual({ checked: 0, expired: 0 });
    expect(await orderDoc(o)).toEqual(before.order);
    expect(await goods()).toEqual(before.goods);
  });

  it.each(["paid", "refunded"])("never releases a %s order, even with an old hold time", async (state) => {
    const o = await placeOrder();
    const p = rz.pay(await startPayment(o));
    await captured(p);
    if (state === "refunded") await refundHook(refundOf(p.id, 190000));
    await expireAt(o, 86_400_000);
    const before = { order: await orderDoc(o), payments: await Payment.find().lean(), goods: await goods() };
    expect((await cron()).body.data).toEqual({ checked: 0, expired: 0 });
    expect(await orderDoc(o)).toEqual(before.order);
    expect(await Payment.find().lean()).toEqual(before.payments);
    expect(await goods()).toEqual(before.goods);
    expect(await releases()).toBe(0);
  });

  it("completes, not releases, an order that was paid although the app never heard", async () => {
    const o = await placeOrder();
    rz.pay(await startPayment(o));
    await expireAt(o);
    expect((await cron()).body.data).toEqual({ checked: 1, expired: 0 });
    expect(await orderDoc(o)).toMatchObject({ status: "placed", paymentStatus: "captured" });
    expect(await stock()).toEqual({ stock: 18, reserved: 0, sold: 2 });
    expect(await releases()).toBe(0);
  });

  it("running it again and again releases nothing more", async () => {
    const o = await placeOrder();
    await expireAt(o);
    for (let i = 0; i < 5; i++) await cron();
    expect(await releases()).toBe(1);
    expect(await couponUses()).toBe(0);
    expect((await orderDoc(o)).statusHistory).toHaveLength(2);
    expect(await stock()).toEqual({ stock: 20, reserved: 0, sold: 0 });
  });

  it("concurrent runs release each order once and leave other holds intact", async () => {
    const due = [await placeOrder(), await placeOrder(), await placeOrder()];
    const live = await placeOrder();
    for (const o of due) await expireAt(o);
    expect(await stock()).toEqual({ stock: 20, reserved: 8, sold: 0 });
    const runs = await Promise.all(Array.from({ length: 6 }, () => cron()));
    expect(runs.every((r) => r.status === 200)).toBe(true);
    expect(runs.reduce((n, r) => n + r.body.data.expired, 0)).toBe(3);
    expect(await stock()).toEqual({ stock: 20, reserved: 2, sold: 0 });
    for (const o of due) {
      const doc = await orderDoc(o);
      expect(await InventoryMovement.countDocuments({ order: doc._id, type: "release" })).toBe(1);
      expect(doc.statusHistory.map((h) => h.status)).toEqual(["pending_payment", "expired"]);
    }
    expect((await orderDoc(live)).status).toBe("pending_payment");
    expect(await couponUses()).toBe(1);
  });

  it("the ledger holds exactly one matching release per order", async () => {
    const o = await placeOrder();
    await expireAt(o);
    await Promise.all([cron(), cron()]);
    await cron();
    const rows = await InventoryMovement.find({ order: (await orderDoc(o))._id }).sort({ createdAt: 1, _id: 1 }).lean();
    expect(rows.map((m) => [m.type, m.stockChange, m.reservedChange, m.reservedAfter])).toEqual([
      ["reservation", 0, 2, 2],
      ["release", 0, -2, 0],
    ]);
  });

  it("one order that fails doesn't stop the others, and is retried next time", async () => {
    const bad = await placeOrder();
    const good = await placeOrder();
    await expireAt(bad, 60_000);
    await expireAt(good, 1000);
    const badId = String((await orderDoc(bad))._id);
    const real = Payment.exists.bind(Payment);
    const spy = vi.spyOn(Payment, "exists").mockImplementation(((filter: Rec) => {
      if (String(filter.order) === badId) throw new Error("temporary database failure");
      return real(filter);
    }) as typeof Payment.exists);
    const r = await cron();
    expect([r.status, r.body.data]).toEqual([200, { checked: 2, expired: 1 }]);
    expect((await orderDoc(bad)).status).toBe("pending_payment");
    expect((await orderDoc(good)).status).toBe("expired");
    expect(await stock()).toEqual({ stock: 20, reserved: 2, sold: 0 });
    spy.mockRestore();
    expect((await cron()).body.data).toEqual({ checked: 1, expired: 1 });
    expect(await releases()).toBe(2);
  });

  it("a release that fails part-way rolls back completely", async () => {
    const o = await placeOrder();
    await expireAt(o);
    const spy = vi.spyOn(CouponRedemption, "findOneAndUpdate").mockImplementation(() => {
      throw new Error("temporary database failure");
    });
    expect((await cron()).body.data).toEqual({ checked: 1, expired: 0 });
    expect(await orderDoc(o)).toMatchObject({ status: "pending_payment", stockReleased: false });
    expect(await stock()).toEqual({ stock: 20, reserved: 2, sold: 0 });
    expect(await releases()).toBe(0);
    spy.mockRestore();
    expect((await cron()).body.data).toEqual({ checked: 1, expired: 1 });
    expect(await releases()).toBe(1);
  });

  it("keeps stock while Razorpay is unreachable, and releases when it can confirm", async () => {
    const o = await placeOrder();
    await startPayment(o);
    await expireAt(o);
    rz.down = true;
    expect((await cron()).body.data).toEqual({ checked: 1, expired: 0 });
    expect((await orderDoc(o)).status).toBe("pending_payment");
    rz.down = false;
    expect((await cron()).body.data).toEqual({ checked: 1, expired: 1 });
    expect(rz.moneyCalls).toEqual([]);
  });
});

/* ---------- Batches and the queue ---------- */

describe("bounded batches", () => {
  it("handles at most one batch per run and finishes the rest on the next", async () => {
    await seedDue(BATCH + 30, "BIG");
    expect((await cron()).body.data).toEqual({ checked: BATCH, expired: BATCH });
    expect(await stillPending("BIG")).toBe(30);
    expect((await cron()).body.data).toEqual({ checked: 30, expired: 30 });
    expect(await stillPending("BIG")).toBe(0);
  }, 60_000);

  it("a full batch of older orders that must be kept can't starve newer ones", async () => {
    rz.down = true; // every order with a payment attempt must be kept for now
    const kept = await seedDue(BATCH, "OLD", { minutesAgo: 120, attempts: 1 });
    await giveAttempts(kept);
    await seedDue(5, "NEW", { minutesAgo: 5 }); // no attempts: safe to release at once
    await cron();
    await cron();
    expect(await stillPending("NEW")).toBe(0);
    expect(await stillPending("OLD")).toBe(BATCH);
  }, 120_000);

  it("a full batch of orders that keep failing can't starve the rest", async () => {
    const poison = await seedDue(BATCH, "BAD", { minutesAgo: 120 });
    await seedDue(4, "FINE", { minutesAgo: 5 });
    const ids = new Set(poison.map((o) => String(o._id)));
    const real = Payment.exists.bind(Payment);
    vi.spyOn(Payment, "exists").mockImplementation(((filter: Rec) => {
      if (ids.has(String(filter.order))) throw new Error("always fails");
      return real(filter);
    }) as typeof Payment.exists);
    await cron();
    await cron();
    expect(await stillPending("FINE")).toBe(0);
  }, 120_000);

  it("looks at each order at most once per run", async () => {
    rz.down = true;
    await giveAttempts(await seedDue(3, "ONCE", { attempts: 1 }));
    await cron();
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(3);
  });

  it("stops in time when Razorpay is slow, and carries on next run", async () => {
    await giveAttempts(await seedDue(12, "SLOW", { attempts: 1 }));
    rz.slowness = 6; // each lookup takes 6 seconds
    const first = await cron();
    expect(first.status).toBe(200);
    expect(first.body.data.checked).toBeGreaterThan(0);
    expect(first.body.data.checked).toBeLessThan(12);
    expect(first.body.data.checked * rz.slowness).toBeLessThan(maxDuration - 10);
    expect(await stillPending("SLOW")).toBe(12 - first.body.data.checked);
    rz.slowness = 0;
    await cron();
    expect(await stillPending("SLOW")).toBe(0);
  });

  it("marking an order as checked doesn't change anything else about it", async () => {
    rz.down = true;
    const o = await placeOrder();
    await startPayment(o);
    await expireAt(o);
    const before = await orderDoc(o);
    await cron();
    const { expiryCheckedAt, paymentLockUntil: _a, ...after } = (await orderDoc(o)) as Rec;
    const { expiryCheckedAt: _b, paymentLockUntil: _c, ...was } = before as Rec;
    void [_a, _b, _c];
    expect(expiryCheckedAt).toBeInstanceOf(Date);
    expect(after).toEqual(was); // including updatedAt
  });

  it("direct calls without a deadline still work as before", async () => {
    await seedDue(3, "PLAIN");
    expect(await expireStaleOrders({ limit: 2 })).toEqual({ checked: 2, expired: 2 });
    expect(await expireStaleOrders({ limit: 2 })).toEqual({ checked: 1, expired: 1 });
  });
});

/* ---------- Saved refunds ---------- */

/**
 * A refund that arrived early and is still waiting although its payment is on record — as left by
 * an interrupted or failed attempt.
 */
async function waitingRefund(amount = 50000) {
  const o = await placeOrder();
  const p = rz.pay(await startPayment(o));
  expect((await captured(p)).status).toBe(200);
  const refund = refundOf(p.id, amount);
  const eventId = rid("evt");
  await WebhookEvent.create({
    provider: "razorpay", eventId, type: "refund.processed", payloadHash: "x", razorpayPaymentId: p.id, status: "deferred",
    refund: { refundId: refund.id, paymentId: p.id, amountPaise: amount, currency: "INR", status: "processed" },
  });
  const mongoId = String((await Payment.findOne({ razorpayPaymentId: p.id }).lean())!._id);
  return { o, p, refund, eventId, mongoId };
}
const refundsOf = async (paymentId: string) => (await Payment.findOne({ razorpayPaymentId: paymentId }).lean())!.refunds.map((r) => [r.razorpayRefundId, r.amountPaise, r.status]);
const eventStatus = async (eventId: string) => (await WebhookEvent.findOne({ eventId }).lean())!.status;

/** Refund writes fail for the chosen payments (as a temporary database error would). */
function failRefundWrites(ids: Set<string>, seen: string[] = []) {
  const real = Payment.findById.bind(Payment);
  return vi.spyOn(Payment, "findById").mockImplementation(((...args: Parameters<typeof Payment.findById>) => {
    seen.push(String(args[0]));
    if (ids.has(String(args[0]))) throw new Error("temporary database failure");
    return real(...args);
  }) as typeof Payment.findById);
}

describe("saved refunds", () => {
  it("applies a waiting refund once", async () => {
    const w = await waitingRefund();
    await cron();
    expect(await refundsOf(w.p.id)).toEqual([[w.refund.id, 50000, "processed"]]);
    expect(await orderDoc(w.o)).toMatchObject({ paymentStatus: "partially_refunded", refundedPaise: 50000 });
    expect(await eventStatus(w.eventId)).toBe("processed");
    await cron();
    expect(await refundsOf(w.p.id)).toHaveLength(1);
  });

  it("a failed retry stays waiting, is tried once per run, and succeeds later", async () => {
    const w = await waitingRefund();
    const seen: string[] = [];
    const spy = failRefundWrites(new Set([w.mongoId]), seen);
    for (let i = 1; i <= 3; i++) {
      seen.length = 0;
      expect((await cron()).status).toBe(200);
      expect(seen.filter((id) => id === w.mongoId)).toHaveLength(1);
      expect(await eventStatus(w.eventId)).toBe("deferred");
    }
    expect(await refundsOf(w.p.id)).toEqual([]);
    spy.mockRestore();
    await cron();
    expect(await refundsOf(w.p.id)).toHaveLength(1);
    expect(await WebhookEvent.findOne({ eventId: w.eventId }).lean()).toMatchObject({ status: "processed", error: null });
  });

  it("one refund that fails doesn't stop the others", async () => {
    const [a, b, c] = [await waitingRefund(), await waitingRefund(), await waitingRefund()];
    failRefundWrites(new Set([b.mongoId]));
    await cron();
    expect(await refundsOf(a.p.id)).toHaveLength(1);
    expect(await refundsOf(b.p.id)).toHaveLength(0);
    expect(await refundsOf(c.p.id)).toHaveLength(1);
  });

  it("a failure while loading one payment's events doesn't stop the others", async () => {
    const [a, b, c] = [await waitingRefund(), await waitingRefund(), await waitingRefund()];
    // The first payment tried is the one whose lookup breaks.
    const real = WebhookEvent.find.bind(WebhookEvent);
    vi.spyOn(WebhookEvent, "find").mockImplementation(((filter: Rec, ...rest: unknown[]) => {
      if (filter?.["refund.paymentId"] === a.p.id) throw new Error("temporary database failure");
      return (real as (...x: unknown[]) => unknown)(filter, ...rest);
    }) as typeof WebhookEvent.find);
    expect((await cron()).status).toBe(200);
    expect(await refundsOf(b.p.id)).toHaveLength(1);
    expect(await refundsOf(c.p.id)).toHaveLength(1);
    expect(logs.join("\n")).toContain("refund.sweep_payment_failed");
  });

  it("is bounded per run, and ones that keep failing can't crowd out the rest", async () => {
    const all = [await waitingRefund(), await waitingRefund(), await waitingRefund(), await waitingRefund()];
    failRefundWrites(new Set([all[0].mongoId, all[1].mongoId]));
    await sweepDeferredRefunds({ limit: 2 });
    await sweepDeferredRefunds({ limit: 2 });
    expect(await refundsOf(all[2].p.id)).toHaveLength(1);
    expect(await refundsOf(all[3].p.id)).toHaveLength(1);
    expect(await WebhookEvent.countDocuments({ status: "deferred" })).toBe(2);
  });

  it("older refunds for unknown payments never use up the batch", async () => {
    for (let i = 0; i < 5; i++) {
      const refund = { refundId: `rfnd_Stranger000${i}`, paymentId: `pay_Stranger0000${i}`, amountPaise: 100, currency: "INR", status: "processed" as const };
      await WebhookEvent.create({ provider: "razorpay", eventId: `evt_stranger_${i}`, type: "refund.processed", payloadHash: "x", status: "deferred", refund });
    }
    const w = await waitingRefund(); // newer than all of them
    expect(await sweepDeferredRefunds({ limit: 1 })).toEqual({ payments: 1, applied: 1, failed: 0 });
    expect(await refundsOf(w.p.id)).toHaveLength(1);
    expect(await WebhookEvent.countDocuments({ status: "deferred" })).toBe(5);
  });

  it("stops at its deadline and resumes on the next run", async () => {
    const all = [await waitingRefund(), await waitingRefund(), await waitingRefund()];
    expect(await sweepDeferredRefunds({ deadline: Date.now() - 1 })).toMatchObject({ applied: 0 });
    expect(await WebhookEvent.countDocuments({ status: "deferred" })).toBe(3);
    await sweepDeferredRefunds();
    for (const w of all) expect(await refundsOf(w.p.id)).toHaveLength(1);
  });

  it("still runs when expiry itself fails, and the run is reported as failed", async () => {
    const w = await waitingRefund();
    vi.spyOn(Order, "find").mockImplementation(() => {
      throw new Error("temporary database failure");
    });
    const r = await cron();
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(await refundsOf(w.p.id)).toHaveLength(1);
  });

  it("a failing refund sweep doesn't undo or fail the expiry", async () => {
    const o = await placeOrder();
    await expireAt(o);
    vi.spyOn(WebhookEvent, "aggregate").mockImplementation(() => {
      throw new Error("temporary database failure");
    });
    vi.spyOn(WebhookEvent, "distinct").mockImplementation(() => {
      throw new Error("temporary database failure");
    });
    const r = await cron();
    expect([r.status, r.body.data]).toEqual([200, { checked: 1, expired: 1 }]);
    expect(logs.join("\n")).toContain("cron.refund_sweep_failed");
  });

  it("duplicate events for one refund, and concurrent runs, apply it once", async () => {
    const w = await waitingRefund();
    const row = { refundId: w.refund.id, paymentId: w.p.id, amountPaise: 50000, currency: "INR", status: "processed" as const };
    for (const id of ["evt_dup_1", "evt_dup_2"]) await WebhookEvent.create({ provider: "razorpay", eventId: id, type: "refund.created", payloadHash: "x", status: "deferred", refund: row });
    const runs = await Promise.all([cron(), cron(), cron(), cron()]);
    expect(runs.every((r) => r.status === 200)).toBe(true);
    await refundHook(w.refund); // delivered again by Razorpay
    expect(await refundsOf(w.p.id)).toEqual([[w.refund.id, 50000, "processed"]]);
    expect(await orderDoc(w.o)).toMatchObject({ refundedPaise: 50000, paymentStatus: "partially_refunded" });
    expect(await WebhookEvent.countDocuments({ type: /^refund\./, status: { $ne: "processed" } })).toBe(0);
  });

  it("a processed refund stays processed when stale events are retried", async () => {
    const w = await waitingRefund();
    await cron();
    for (const status of ["pending", "failed"] as const) {
      await WebhookEvent.create({ provider: "razorpay", eventId: `evt_stale_${status}`, type: "refund.created", payloadHash: "x", status: "deferred", refund: { refundId: w.refund.id, paymentId: w.p.id, amountPaise: 50000, currency: "INR", status } });
    }
    await cron();
    await refundHook({ ...w.refund, status: "pending" });
    expect(await refundsOf(w.p.id)).toEqual([[w.refund.id, 50000, "processed"]]);
    expect(await orderDoc(w.o)).toMatchObject({ refundedPaise: 50000 });
  });

  it("changes no stock, sold count or coupon record, and calls no gateway", async () => {
    const [a] = [await waitingRefund(190000), await waitingRefund()];
    const before = await goods();
    (fetch as unknown as { mockClear: () => void }).mockClear();
    await cron();
    expect(await goods()).toEqual(before);
    expect((await orderDoc(a.o)).paymentStatus).toBe("refunded");
    expect(fetch).not.toHaveBeenCalled();
    expect(rz.moneyCalls).toEqual([]);
  });

  it("leaves refunds for unknown payments, and fresh in-progress events, waiting", async () => {
    const w = await waitingRefund();
    const unknown = { refundId: "rfnd_Unknown0001", paymentId: "pay_NotOurs000001", amountPaise: 100, currency: "INR", status: "processed" as const };
    await WebhookEvent.create({ provider: "razorpay", eventId: "evt_unknown", type: "refund.processed", payloadHash: "x", status: "deferred", refund: unknown });
    await WebhookEvent.updateOne({ eventId: w.eventId }, { $set: { status: "processing" } });
    await cron();
    expect(await eventStatus("evt_unknown")).toBe("deferred");
    expect(await refundsOf(w.p.id)).toEqual([]); // possibly still being handled
    clock = 6 * 60_000; // now it counts as interrupted
    await cron();
    expect(await refundsOf(w.p.id)).toHaveLength(1);
  });

  it("keeps the 90-day retention index", async () => {
    const ttl = (await WebhookEvent.collection.indexes()).find((i) => i.expireAfterSeconds !== undefined);
    expect(ttl).toMatchObject({ key: { createdAt: 1 }, expireAfterSeconds: 90 * 24 * 60 * 60 });
  });
});

/* ---------- Schedule ---------- */

describe("Vercel configuration", () => {
  const config = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] } & Rec;

  it("schedules the expiry route, and every scheduled path is a real GET route", () => {
    expect(config.crons.map((c) => c.path)).toContain("/api/v1/cron/expire-orders");
    for (const c of config.crons) expect(existsSync(`src/app${c.path}/route.ts`), c.path).toBe(true);
  });

  it("uses schedules every Vercel plan accepts (at most once a day)", () => {
    for (const c of config.crons) {
      const [minute, hour, ...rest] = c.schedule.split(" ");
      expect([minute, hour].every((f) => /^\d+$/.test(f)), c.schedule).toBe(true);
      expect(rest).toHaveLength(3);
    }
  });

  it("keeps the existing media cleanup job and adds no other settings", () => {
    expect(config.crons).toContainEqual({ path: "/api/v1/cron/cleanup-media", schedule: "30 21 * * *" });
    expect(Object.keys(config).sort()).toEqual(["$schema", "crons"]);
  });
});
