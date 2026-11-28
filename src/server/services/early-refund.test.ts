import { createHmac, randomBytes } from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { NextRequest, type NextResponse } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as adminLogin } from "@/app/api/v1/admin/auth/login/route";
import { GET as paymentRoute } from "@/app/api/v1/admin/payments/[id]/route";
import { POST as syncRoute } from "@/app/api/v1/admin/payments/[id]/refunds/[refundId]/route";
import { POST as addLine } from "@/app/api/v1/cart/items/route";
import { POST as placeRoute } from "@/app/api/v1/checkout/orders/route";
import { GET as expireRoute } from "@/app/api/v1/cron/expire-orders/route";
import { POST as retryRoute } from "@/app/api/v1/payments/[orderId]/retry/route";
import { POST as createRoute } from "@/app/api/v1/payments/razorpay/create/route";
import { POST as verifyRoute } from "@/app/api/v1/payments/razorpay/verify/route";
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
 * Refund webhooks that arrive before the app has recorded their payment: kept, then applied once
 * the payment is known. Real API routes, an in-memory replica set and a fake Razorpay.
 */

const KEY_ID = "rzp_test_EarlyRefund12";
const KEY_SECRET = "early-key-secret";
const WEBHOOK_SECRET = "early-webhook-secret";
const ORIGIN = "http://localhost:3000";
const PW = "Correct-horse-42";
const TOTAL = 190000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>;
const rid = (p: string) => `${p}_${randomBytes(7).toString("hex")}`;

/* ---------- Fake Razorpay ---------- */

const rz = {
  orders: new Map<string, Rec>(),
  payments: new Map<string, Rec>(),
  refunds: new Map<string, Rec>(),
  /** Every gateway request that could move money. */
  moneyCalls: [] as string[],
  reset() {
    this.orders.clear();
    this.payments.clear();
    this.refunds.clear();
    this.moneyCalls = [];
  },
  pay(orderId: string) {
    const o = this.orders.get(orderId)!;
    const p = { id: rid("pay"), order_id: orderId, amount: o.amount, currency: "INR", status: "captured", method: "upi", international: false, captured: true, fee: 0, tax: 0 };
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
    if (method === "GET" && (m = path.match(/^\/orders\/([^/]+)\/payments$/))) return json({ items: [...this.payments.values()].filter((p) => p.order_id === m![1]) });
    if (method === "GET" && (m = path.match(/^\/payments\/([^/]+)$/))) return json(this.payments.get(m[1]));
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
  seq += 1;
  const headers: Record<string, string> = { "x-forwarded-for": `10.9.${Math.floor(seq / 250) % 250}.${seq % 250}`, ...init.headers };
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
          idempotencyKey: `early-${Date.now()}-${++seq}-abcdef`,
          expectedTotalPaise: TOTAL,
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

function webhook(event: string, payload: Rec, eventId = rid("evt"), secret = WEBHOOK_SECRET) {
  const raw = JSON.stringify({ entity: "event", event, payload, created_at: 1 });
  const signature = createHmac("sha256", secret).update(raw).digest("hex");
  return call(webhookRoute(req("/api/v1/payments/razorpay/webhook", { raw, origin: null, headers: { "x-razorpay-signature": signature, "x-razorpay-event-id": eventId } }), ctx()));
}
const captured = (p: Rec, eventId?: string) => webhook("payment.captured", { payment: { entity: p } }, eventId);
const refundHook = (refund: Rec, type: "created" | "processed" | "failed" = "processed", eventId?: string) => webhook(`refund.${type}`, { refund: { entity: refund } }, eventId);

/** A refund as Razorpay would describe it (made in the Dashboard, so the app never asked for it). */
const refundOf = (p: Rec, amount = TOTAL, status = "processed"): Rec => ({ id: `rfnd_${randomBytes(7).toString("hex")}`, entity: "refund", amount, currency: "INR", payment_id: p.id, status, notes: [] });

/** An order awaiting payment, whose payment has happened at Razorpay but isn't known here yet. */
async function unknownPayment() {
  const o = await placeOrder();
  return { o, p: rz.pay(await startPayment(o)) };
}

const orderDoc = async (o: Placed) => (await Order.findOne({ orderNumber: o.id }).lean())!;
const paymentDoc = async (razorpayPaymentId: string) => (await Payment.findOne({ razorpayPaymentId }).lean())!;
const eventDoc = async (eventId: string) => (await WebhookEvent.findOne({ eventId }).lean()) as Rec;
const stock = async () => {
  const p = (await Product.findById(productId, { variants: 1, soldCount: 1 }).lean())!;
  return { stock: p.variants[0].stock, reserved: p.variants[0].reserved, sold: p.soldCount };
};
/** Stock, ledger and coupon: what refund reconciliation must never change. */
const goods = async () =>
  JSON.parse(
    JSON.stringify({
      stock: await stock(),
      ledger: await InventoryMovement.find().sort({ createdAt: 1, _id: 1 }).lean(),
      coupon: (await Coupon.findOne({ code: "FLAT100" }).lean())!.usageCount,
      redemptions: await CouponRedemption.find().lean(),
    }),
  );
const rows = async (p: Rec) => (await paymentDoc(p.id)).refunds.map((r) => [r.razorpayRefundId, r.amountPaise, r.status]);

/** The state every successful scenario must end in: one sale, and the refunds on payment and order. */
async function expectSettled(o: Placed, p: Rec, refundedPaise: number, status: "captured" | "partially_refunded" | "refunded") {
  expect(await paymentDoc(p.id)).toMatchObject({ status, refundedPaise });
  expect(await orderDoc(o)).toMatchObject({ status: "placed", paymentStatus: status, refundedPaise, razorpayPaymentId: p.id });
  expect(await stock()).toEqual({ stock: 8, reserved: 0, sold: 2 });
  expect(await InventoryMovement.countDocuments({ type: "sale" })).toBe(1);
  expect(await InventoryMovement.countDocuments()).toBe(2); // reservation + sale, nothing from refunds
  expect((await Coupon.findOne({ code: "FLAT100" }).lean())!.usageCount).toBe(1);
  expect((await CouponRedemption.find().lean()).map((r) => r.status)).toEqual(["redeemed"]);
  expect(rz.moneyCalls).toEqual([]);
}

/** Makes the next `times` refund writes fail, as a temporary database error would. */
function breakRefundWrites(times: number) {
  const real = Payment.findById.bind(Payment);
  let left = times;
  return vi.spyOn(Payment, "findById").mockImplementation(((...args: Parameters<typeof Payment.findById>) => {
    // Only recordRefund reads a payment by ID during webhook handling.
    if (left > 0) {
      left -= 1;
      throw new Error("temporary database failure");
    }
    return real(...args);
  }) as typeof Payment.findById);
}

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  vi.stubEnv("MONGODB_URI", rs.getUri());
  vi.stubEnv("MONGODB_DB_NAME", "mm-early-refund-test");
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
  vi.restoreAllMocks();
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

async function resetStock() {
  await Promise.all([InventoryMovement.deleteMany({}), CouponRedemption.deleteMany({}), Order.deleteMany({}), Payment.deleteMany({}), WebhookEvent.deleteMany({}), Cart.deleteMany({})]);
  await Coupon.updateMany({}, { $set: { usageCount: 0 } });
  await Product.updateOne({ _id: productId }, { $set: { "variants.0.stock": 10, "variants.0.reserved": 0, soldCount: 0 } });
}

/* ---------- Kept, then applied ---------- */

describe("a refund that arrives before its payment is known", () => {
  it("is kept with its verified details and changes nothing yet", async () => {
    const { o, p } = await unknownPayment();
    const refund: Rec = { ...refundOf(p), notes: { reason: "customer text", private: "do-not-store" } };
    const before = { goods: await goods(), order: await orderDoc(o) };
    const r = await refundHook(refund, "processed", "evt_keep");
    expect([r.status, r.body.data]).toEqual([200, { duplicate: false, status: "deferred" }]);
    const stored = await eventDoc("evt_keep");
    expect(stored).toMatchObject({ status: "deferred", razorpayPaymentId: p.id, refund: { refundId: refund.id, paymentId: p.id, amountPaise: TOTAL, currency: "INR", status: "processed" } });
    expect(JSON.stringify(stored)).not.toContain("do-not-store");
    expect(await goods()).toEqual(before.goods);
    expect(await orderDoc(o)).toEqual(before.order);
  });

  it.each(["payment webhook", "checkout verification", "cron reconciliation"])("is applied as soon as the %s records the payment", async (via) => {
    const { o, p } = await unknownPayment();
    const refund = refundOf(p);
    await refundHook(refund, "processed", "evt_apply");
    if (via === "payment webhook") expect((await captured(p)).body.data.status).toBe("paid");
    else if (via === "checkout verification") expect((await checkoutVerify(o, p)).body.data.result).toBe("paid");
    else {
      await Order.updateOne({ orderNumber: o.id }, { $set: { reservationExpiresAt: new Date(Date.now() - 1000) } });
      await call(expireRoute(req("/api/v1/cron/expire-orders", { method: "GET", headers: { authorization: `Bearer ${"c".repeat(32)}` } }), ctx()));
    }
    await expectSettled(o, p, TOTAL, "refunded");
    expect(await rows(p)).toEqual([[refund.id, TOTAL, "processed"]]);
    expect((await paymentDoc(p.id)).refunds[0].source).toBe("webhook");
    expect(await eventDoc("evt_apply")).toMatchObject({ status: "processed", error: null, order: (await orderDoc(o))._id });
  });

  it("shows up in the admin payment detail", async () => {
    const { p } = await unknownPayment();
    await refundHook(refundOf(p, 50000));
    await captured(p);
    const id = String((await paymentDoc(p.id))._id);
    const d = (await call(paymentRoute(req(`/api/v1/admin/payments/${id}`, { method: "GET", jar: admin }), ctx({ id })))).body.data;
    expect(d.refunds).toHaveLength(1);
    expect(d.webhooks.map((w: Rec) => [w.type, w.status]).sort()).toEqual([["payment.captured", "processed"], ["refund.processed", "processed"]]);
  });
});

/* ---------- Idempotency ---------- */

describe("duplicates", () => {
  it("the same early event delivered twice is stored once and applied once", async () => {
    const { o, p } = await unknownPayment();
    const refund = refundOf(p, 50000);
    await refundHook(refund, "processed", "evt_twice");
    const again = await refundHook(refund, "processed", "evt_twice");
    expect([again.status, again.body.data.status]).toEqual([200, "deferred"]);
    expect(await WebhookEvent.countDocuments()).toBe(1);
    expect((await eventDoc("evt_twice")).attempts).toBe(2);
    await captured(p);
    await expectSettled(o, p, 50000, "partially_refunded");
    expect(await rows(p)).toHaveLength(1);
  });

  it("the same event ID after the payment is recorded is acknowledged and not applied again", async () => {
    const { o, p } = await unknownPayment();
    const refund = refundOf(p, 50000);
    await refundHook(refund, "processed", "evt_after");
    await captured(p);
    const r = await refundHook(refund, "processed", "evt_after");
    expect(r.body.data).toEqual({ duplicate: true, status: "processed" });
    await expectSettled(o, p, 50000, "partially_refunded");
    expect(await rows(p)).toHaveLength(1);
  });

  it("a redelivery applies a kept refund whose payment is now known", async () => {
    const { o, p } = await unknownPayment();
    const refund = refundOf(p, 50000);
    await captured(p);
    // As left behind if the app stopped between recording the payment and applying the refund.
    await WebhookEvent.create({ provider: "razorpay", eventId: "evt_stuck", type: "refund.processed", payloadHash: "x", razorpayPaymentId: p.id, status: "deferred", refund: { refundId: refund.id, paymentId: p.id, amountPaise: 50000, currency: "INR", status: "processed" } });
    const r = await refundHook(refund, "processed", "evt_stuck");
    expect(r.body.data).toEqual({ duplicate: false, status: "recorded" });
    await expectSettled(o, p, 50000, "partially_refunded");
  });

  it("different event IDs for one refund apply it once", async () => {
    const { o, p } = await unknownPayment();
    const refund = refundOf(p, 50000);
    for (const [type, id] of [["created", "evt_a"], ["processed", "evt_b"], ["processed", "evt_c"]] as const) await refundHook(refund, type, id);
    await captured(p);
    await expectSettled(o, p, 50000, "partially_refunded");
    expect(await rows(p)).toEqual([[refund.id, 50000, "processed"]]);
    expect(await WebhookEvent.countDocuments({ type: /^refund\./, status: "processed" })).toBe(3);
    // A fourth event after the payment, and a payment replay, still change nothing.
    expect((await refundHook(refund)).body.data.status).toBe("unchanged");
    expect((await captured(p)).body.data.status).toBe("already_paid");
    await expectSettled(o, p, 50000, "partially_refunded");
  });
});

/* ---------- Several refunds, any order ---------- */

describe("multiple and out-of-order refunds", () => {
  it("applies several early partial refunds", async () => {
    const { o, p } = await unknownPayment();
    for (const amount of [30000, 20000, 10000]) await refundHook(refundOf(p, amount));
    await captured(p);
    await expectSettled(o, p, 60000, "partially_refunded");
    expect((await rows(p)).map((r) => r[1]).sort()).toEqual([10000, 20000, 30000]);
  });

  it("a partial followed by the rest ends fully refunded, whether both or only one came early", async () => {
    const { o, p } = await unknownPayment();
    await refundHook(refundOf(p, 50000));
    await refundHook(refundOf(p, TOTAL - 50000));
    await captured(p);
    await expectSettled(o, p, TOTAL, "refunded");

    await resetStock();
    const second = await unknownPayment();
    await refundHook(refundOf(second.p, 50000));
    await captured(second.p);
    await expectSettled(second.o, second.p, 50000, "partially_refunded");
    await refundHook(refundOf(second.p, TOTAL - 50000));
    await expectSettled(second.o, second.p, TOTAL, "refunded");
  });

  const ORDERS: [string, ("pending" | "processed" | "failed")[], "processed" | "failed"][] = [
    ["processed then pending", ["processed", "pending"], "processed"],
    ["pending then processed", ["pending", "processed"], "processed"],
    ["failed then pending", ["failed", "pending"], "failed"],
    ["processed then failed", ["processed", "failed"], "processed"],
    ["failed then processed", ["failed", "processed"], "processed"],
    ["processed, failed, pending", ["processed", "failed", "pending"], "processed"],
  ];
  const TYPE = { pending: "created", processed: "processed", failed: "failed" } as const;

  it.each(ORDERS)("kept early, %s", async (_label, statuses, final) => {
    const { o, p } = await unknownPayment();
    const refund = refundOf(p, 50000);
    for (const s of statuses) await refundHook({ ...refund, status: s }, TYPE[s]);
    await captured(p);
    expect(await rows(p)).toEqual([[refund.id, 50000, final]]);
    await expectSettled(o, p, final === "failed" ? 0 : 50000, final === "failed" ? "captured" : "partially_refunded");
  });

  it.each(ORDERS)("arriving after the payment, %s", async (_label, statuses, final) => {
    const { o, p } = await unknownPayment();
    await captured(p);
    const refund = refundOf(p, 50000);
    for (const s of statuses) await refundHook({ ...refund, status: s }, TYPE[s]);
    expect(await rows(p)).toEqual([[refund.id, 50000, final]]);
    await expectSettled(o, p, final === "failed" ? 0 : 50000, final === "failed" ? "captured" : "partially_refunded");
  });

  it("a live status sync from Razorpay can still correct a processed refund to failed", async () => {
    const { o, p } = await unknownPayment();
    const refund = refundOf(p, 50000);
    await refundHook(refund);
    await captured(p);
    rz.refunds.set(refund.id, { ...refund, status: "failed" });
    const id = String((await paymentDoc(p.id))._id);
    const r = await call(syncRoute(req(`/api/v1/admin/payments/${id}/refunds/${refund.id}`, { jar: admin, body: {} }), ctx({ id, refundId: refund.id })));
    expect(r.status).toBe(200);
    await expectSettled(o, p, 0, "captured");
  });
});

/* ---------- Duplicate, late and mismatched payments ---------- */

describe("early refunds of other kinds of payment", () => {
  it("of a duplicate payment: recorded on it, order untouched", async () => {
    const o = await placeOrder();
    const first = await startPayment(o);
    const second = await retryPayment(o);
    const original = rz.pay(first);
    await captured(original);
    const extra = rz.pay(second);
    const refund = refundOf(extra);
    expect((await refundHook(refund)).body.data.status).toBe("deferred");
    expect((await captured(extra)).body.data.status).toBe("duplicate");
    expect(await rows(extra)).toEqual([[refund.id, TOTAL, "processed"]]);
    expect(await rows(original)).toEqual([]);
    await expectSettled(o, original, 0, "captured");
  });

  it("of a payment that arrives after expiry: applied, with one late sale", async () => {
    const { o, p } = await unknownPayment();
    await refundHook(refundOf(p, 50000));
    // Expire without the gateway knowing about the payment yet.
    rz.payments.delete(p.id);
    await Order.updateOne({ orderNumber: o.id }, { $set: { reservationExpiresAt: new Date(Date.now() - 1000) } });
    await call(expireRoute(req("/api/v1/cron/expire-orders", { method: "GET", headers: { authorization: `Bearer ${"c".repeat(32)}` } }), ctx()));
    expect((await captured(p)).body.data.status).toBe("late_paid");
    expect(await orderDoc(o)).toMatchObject({ status: "placed", paymentStatus: "partially_refunded", refundedPaise: 50000 });
    expect(await stock()).toEqual({ stock: 8, reserved: 0, sold: 2 });
    expect(await InventoryMovement.countDocuments({ type: "sale" })).toBe(1);
  });

  it("a refund for an unrelated payment is kept and never applied elsewhere", async () => {
    const { o, p } = await unknownPayment();
    await refundHook(refundOf({ id: "pay_SomeoneElse001" }), "processed", "evt_other");
    await captured(p);
    expect(await eventDoc("evt_other")).toMatchObject({ status: "deferred" });
    await expectSettled(o, p, 0, "captured");
  });

  it("a non-INR early refund is rejected when applied", async () => {
    const { o, p } = await unknownPayment();
    await refundHook({ ...refundOf(p, 50000), currency: "USD" }, "processed", "evt_usd");
    await captured(p);
    expect(await eventDoc("evt_usd")).toMatchObject({ status: "ignored" });
    expect(await rows(p)).toEqual([]);
    await expectSettled(o, p, 0, "captured");
  });

  it("malformed refund data is ignored, not stored", async () => {
    const { p } = await unknownPayment();
    const bad: Rec[] = [
      { ...refundOf(p), amount: -5 },
      { ...refundOf(p), amount: 10.5 },
      { ...refundOf(p), amount: "190000" },
      { ...refundOf(p), status: "weird" },
      { ...refundOf(p), id: undefined },
      { ...refundOf(p), payment_id: undefined },
      { ...refundOf(p), currency: undefined },
    ];
    for (const refund of bad) {
      const r = await refundHook(refund);
      expect([r.status, r.body.data.status]).toEqual([200, "ignored"]);
    }
    expect(await WebhookEvent.countDocuments({ status: "deferred" })).toBe(0);
  });
});

/* ---------- Concurrency ---------- */

describe("refund and payment at the same time", () => {
  it.each(["payment webhook", "checkout verification"])("never strands the refund — racing the %s", async (via) => {
    for (let i = 0; i < 12; i++) {
      await resetStock();
      const { o, p } = await unknownPayment();
      const refund = refundOf(p, 50000);
      const results = await Promise.all([refundHook(refund, "processed", `evt_race_${i}`), via === "payment webhook" ? captured(p) : checkoutVerify(o, p)]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      expect(await rows(p), `round ${i}`).toEqual([[refund.id, 50000, "processed"]]);
      expect(await eventDoc(`evt_race_${i}`)).toMatchObject({ status: "processed" });
      await expectSettled(o, p, 50000, "partially_refunded");
    }
  }, 60_000);

  it.each(["payment webhook", "checkout verification"])("forced worst case: the %s completes between the refund's lookup and its 'deferred' mark", async (via) => {
    const { o, p } = await unknownPayment();
    const refund = refundOf(p, 50000);
    const real = WebhookEvent.updateOne.bind(WebhookEvent);
    let forced = false;
    vi.spyOn(WebhookEvent, "updateOne").mockImplementation(((...args: Parameters<typeof WebhookEvent.updateOne>) => {
      const update = args[1] as { $set?: Rec };
      if (forced || update.$set?.status !== "deferred") return real(...args);
      forced = true;
      // The refund's lookup has already found no payment. Record the payment completely, then carry on.
      return (async () => {
        const r = via === "payment webhook" ? await captured(p) : await checkoutVerify(o, p);
        expect(r.status).toBe(200);
        return real(...args);
      })() as unknown as ReturnType<typeof WebhookEvent.updateOne>;
    }) as typeof WebhookEvent.updateOne);
    const r = await refundHook(refund, "processed", "evt_forced");
    expect([forced, r.status]).toEqual([true, 200]);
    expect(await rows(p)).toEqual([[refund.id, 50000, "processed"]]);
    expect(await eventDoc("evt_forced")).toMatchObject({ status: "processed" }); // the late mark didn't undo it
    await expectSettled(o, p, 50000, "partially_refunded");
  });

  it("several refunds, repeats and payment events together apply each refund once", async () => {
    for (let i = 0; i < 5; i++) {
      await resetStock();
      const { o, p } = await unknownPayment();
      const [a, b] = [refundOf(p, 30000), refundOf(p, 20000)];
      const results = await Promise.all([
        refundHook(a, "processed", `evt_m1_${i}`),
        refundHook(a, "created"),
        refundHook(b),
        captured(p),
        checkoutVerify(o, p),
        webhook("order.paid", { payment: { entity: p } }),
        refundHook({ ...b, status: "pending" }, "created"),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200, 200]);
      expect((await rows(p)).map((r) => [r[1], r[2]]).sort()).toEqual([[20000, "processed"], [30000, "processed"]]);
      await expectSettled(o, p, 50000, "partially_refunded");
      expect(await WebhookEvent.countDocuments({ type: /^refund\./, status: { $ne: "processed" } })).toBe(0);
    }
  }, 60_000);
});

/* ---------- Temporary failures ---------- */

describe("temporary failures", () => {
  it("during a payment webhook: the payment stays recorded, and Razorpay's retry applies the refund", async () => {
    const { o, p } = await unknownPayment();
    const refund = refundOf(p, 50000);
    await refundHook(refund, "processed", "evt_fail");
    breakRefundWrites(1);
    const first = await captured(p, "evt_pay_retry");
    expect(first.status).toBeGreaterThanOrEqual(500);
    expect(await eventDoc("evt_pay_retry")).toMatchObject({ status: "failed" });
    expect(await eventDoc("evt_fail")).toMatchObject({ status: "deferred", error: "temporary database failure" });
    expect((await orderDoc(o)).paymentStatus).toBe("captured");
    expect(await rows(p)).toEqual([]);

    const retry = await captured(p, "evt_pay_retry");
    expect([retry.status, retry.body.data.status]).toEqual([200, "already_paid"]);
    await expectSettled(o, p, 50000, "partially_refunded");
    expect(await eventDoc("evt_fail")).toMatchObject({ status: "processed", error: null });
  });

  it("during checkout verification: the customer still sees success; the payment webhook finishes the job", async () => {
    const { o, p } = await unknownPayment();
    await refundHook(refundOf(p, 50000));
    breakRefundWrites(1);
    const r = await checkoutVerify(o, p);
    expect([r.status, r.body.data.result]).toEqual([200, "paid"]);
    expect(await WebhookEvent.countDocuments({ status: "deferred" })).toBe(1);
    expect((await captured(p)).status).toBe(200);
    await expectSettled(o, p, 50000, "partially_refunded");
  });

  it("the cron picks up a refund left behind", async () => {
    const { o, p } = await unknownPayment();
    await refundHook(refundOf(p, 50000));
    breakRefundWrites(1);
    await checkoutVerify(o, p);
    vi.restoreAllMocks();
    const r = await call(expireRoute(req("/api/v1/cron/expire-orders", { method: "GET", headers: { authorization: `Bearer ${"c".repeat(32)}` } }), ctx()));
    expect([r.status, r.body.data]).toEqual([200, { checked: 0, expired: 0 }]);
    await expectSettled(o, p, 50000, "partially_refunded");
  });

  it("of a refund webhook for a known payment: it fails with 5xx and its retry applies once", async () => {
    const { o, p } = await unknownPayment();
    await captured(p);
    const refund = refundOf(p, 50000);
    breakRefundWrites(1);
    expect((await refundHook(refund, "processed", "evt_known")).status).toBeGreaterThanOrEqual(500);
    expect(await eventDoc("evt_known")).toMatchObject({ status: "failed" });
    const retry = await refundHook(refund, "processed", "evt_known");
    expect([retry.status, retry.body.data.status]).toEqual([200, "recorded"]);
    await expectSettled(o, p, 50000, "partially_refunded");
    expect(await rows(p)).toHaveLength(1);
  });
});

/* ---------- Later events and security ---------- */

describe("after reconciliation", () => {
  it("late payment events and replays keep the refund and never sell again", async () => {
    const { o, p } = await unknownPayment();
    await refundHook(refundOf(p));
    await captured(p);
    const before = { goods: await goods(), order: await orderDoc(o), payment: await paymentDoc(p.id) };
    await captured(p);
    await webhook("order.paid", { payment: { entity: p } });
    await webhook("payment.authorized", { payment: { entity: { ...p, status: "authorized" } } });
    await webhook("payment.failed", { payment: { entity: { ...p, id: rid("pay"), status: "failed" } } });
    await checkoutVerify(o, p);
    expect(await goods()).toEqual(before.goods);
    expect((await orderDoc(o)).paymentStatus).toBe("refunded");
    expect((await paymentDoc(p.id)).refunds).toEqual(before.payment.refunds);
    expect((await paymentDoc(p.id)).status).toBe("refunded");
    await expectSettled(o, p, TOTAL, "refunded");
  });
});

describe("security", () => {
  it("rejects invalid or missing signatures without storing anything", async () => {
    const { o, p } = await unknownPayment();
    const forged = await webhook("refund.processed", { refund: { entity: refundOf(p) } }, "evt_forged", "wrong-secret");
    expect(forged.status).toBe(400);
    const unsigned = await call(webhookRoute(req("/api/v1/payments/razorpay/webhook", { raw: JSON.stringify({ event: "refund.processed", payload: { refund: { entity: refundOf(p) } } }), origin: null }), ctx()));
    expect(unsigned.status).toBe(400);
    expect(await WebhookEvent.countDocuments()).toBe(0);
    await captured(p);
    await expectSettled(o, p, 0, "captured");
  });

  it("a tampered body can't replace a kept refund", async () => {
    const { o, p } = await unknownPayment();
    const refund = refundOf(p, 50000);
    await refundHook(refund, "processed", "evt_tamper");
    expect((await webhook("refund.processed", { refund: { entity: { ...refund, amount: TOTAL } } }, "evt_tamper", "wrong-secret")).status).toBe(400);
    await captured(p);
    await expectSettled(o, p, 50000, "partially_refunded");
  });
});
