import { createHmac, randomBytes } from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { Types } from "mongoose";
import { NextRequest, type NextResponse } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as adminLogin } from "@/app/api/v1/admin/auth/login/route";
import { GET as cancellationsRoute } from "@/app/api/v1/admin/cancellations/route";
import { GET as adminOrderRoute } from "@/app/api/v1/admin/orders/[id]/route";
import { PATCH as orderStatusRoute } from "@/app/api/v1/admin/orders/[id]/status/route";
import { POST as refundRoute } from "@/app/api/v1/admin/payments/[id]/refunds/route";
import { POST as returnNoteRoute } from "@/app/api/v1/admin/returns/[id]/notes/route";
import * as adminReturnRoute from "@/app/api/v1/admin/returns/[id]/route";
import { GET as returnsRoute } from "@/app/api/v1/admin/returns/route";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as addLine } from "@/app/api/v1/cart/items/route";
import { POST as placeRoute } from "@/app/api/v1/checkout/orders/route";
import { GET as afterSalesRoute } from "@/app/api/v1/orders/[id]/after-sales/route";
import { POST as cancelRoute } from "@/app/api/v1/orders/[id]/cancel/route";
import { POST as returnRoute } from "@/app/api/v1/orders/[id]/returns/route";
import { GET as customerOrderRoute } from "@/app/api/v1/orders/[id]/route";
import { POST as createPaymentRoute } from "@/app/api/v1/payments/razorpay/create/route";
import { POST as webhookRoute } from "@/app/api/v1/payments/razorpay/webhook/route";
import ReturnPolicyPage from "@/app/(store)/return-policy/page";
import { refundMessage } from "@/components/account/AfterSales";
import { ADMIN_NAV } from "@/components/admin/layout/admin-nav";
import { ReturnPolicyContent } from "@/components/layout/ReturnPolicyContent";
import { CANCEL_REASONS, RETURN_REASONS, RETURN_REASON_KEYS, cancelAction, returnRules } from "@/lib/after-sales";
import { DAMAGE_CLAIM_HOURS, RETURN_WINDOW_DAYS, isNightwear } from "@/lib/policies";
import { hashPassword } from "@/server/auth/password";
import { DEFAULT_ROLE_PERMISSIONS } from "@/server/auth/permissions";
import { resetEnvCache } from "@/server/config/env";
import { connectToDatabase, disconnectFromDatabase } from "@/server/db/connect";
import * as models from "@/server/models";
import { Admin, Category, Coupon, CouponRedemption, InventoryMovement, Order, Payment, Product, ReturnRequest, Role, User } from "@/server/models";
import { resetRateLimits } from "@/server/security/rate-limit";
import type { StoreOrderStatus } from "@/types";

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }));

/**
 * Customer cancellation and return requests, through the real API routes against a throwaway
 * in-memory replica set. Razorpay and the email service are faked: no real payments, refunds or
 * emails.
 */

const ORIGIN = "http://localhost:3000";
const PW = "Correct-horse-42";
const WEBHOOK_SECRET = "after-sales-webhook-secret";
const PRICE = 100000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Jar = Record<string, string>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>;
type As = "owner" | "manager" | "staff";
const admins = {} as Record<As, Jar>;
const rid = (p: string) => `${p}_${randomBytes(7).toString("hex")}`;
let rs: MongoMemoryReplSet;
type P = { _id: Types.ObjectId; id: string; slug: string; sku: string; name: string; category: Types.ObjectId };
const product = {} as Record<"kurti" | "dress" | "night", P>;
let seq = 0;

/* ---------- Fake Razorpay and email ---------- */

const gateway = {
  payments: new Map<string, Rec>(),
  refunds: new Map<string, Rec>(),
  moneyCalls: [] as string[],
  emails: [] as Rec[],
  emailDown: false,
};

const fetchSpy = vi.fn(async (input: unknown, init: RequestInit = {}) => {
  const url = String(input);
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  if (url === "https://api.resend.com/emails") {
    if (gateway.emailDown) return json({ message: "down" }, 500);
    gateway.emails.push(JSON.parse(String(init.body)));
    return json({ id: rid("mail") });
  }
  if (!url.startsWith("https://api.razorpay.com/v1/")) throw new Error(`Unexpected network call: ${url}`);
  const where = url.replace("https://api.razorpay.com/v1", "").split("?")[0];
  const method = init.method ?? "GET";
  const body = init.body ? JSON.parse(String(init.body)) : {};
  let m: RegExpMatchArray | null;
  if (method === "POST" && where === "/orders") return json({ id: rid("order"), amount: body.amount, currency: body.currency, receipt: body.receipt, status: "created" });
  if (method === "GET" && (m = where.match(/^\/payments\/([^/]+)$/))) return json(gateway.payments.get(m[1]));
  if (method === "POST" && (m = where.match(/^\/payments\/([^/]+)\/refund$/))) {
    gateway.moneyCalls.push(where);
    const refund = { id: rid("rfnd"), payment_id: m[1], amount: body.amount, currency: "INR", status: "pending", notes: body.notes };
    gateway.refunds.set(refund.id, refund);
    return json(refund);
  }
  return json({ error: { description: "not found" } }, 404);
});

/* ---------- Harness ---------- */

function req(path: string, init: { method?: string; body?: unknown; raw?: string; jar?: Jar | null; origin?: string; headers?: Record<string, string> } = {}) {
  seq += 1;
  const headers: Record<string, string> = { origin: init.origin ?? ORIGIN, "x-forwarded-for": `10.6.${Math.floor(seq / 250) % 250}.${seq % 250}`, ...init.headers };
  if (init.body !== undefined || init.raw !== undefined) headers["content-type"] = "application/json";
  if (init.jar && Object.keys(init.jar).length) headers.cookie = Object.entries(init.jar).map(([k, v]) => `${k}=${v}`).join("; ");
  return new NextRequest(`${ORIGIN}${path}`, { method: init.method ?? "GET", headers, body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)) });
}
const ctx = <T extends Record<string, string>>(params: T = {} as T) => ({ params: Promise.resolve(params) });
const cookiesOf = (res: Response): Jar => Object.fromEntries((res as NextResponse).cookies.getAll().filter((c) => c.value).map((c) => [c.name, c.value]));
type Body = { success: boolean; message: string; data: Rec; error?: { code: string } };
const call = async (res: Response | Promise<Response>) => {
  const r = await res;
  return { status: r.status, body: (await r.clone().json()) as Body };
};
type Ref = { orderNumber: string };
const view = (o: Ref, jar: Jar | null) => call(afterSalesRoute(req(`/api/v1/orders/${o.orderNumber}/after-sales`, { jar }), ctx({ id: o.orderNumber })));
const cancel = (o: Ref, jar: Jar | null, body: Rec = {}, origin?: string) =>
  call(cancelRoute(req(`/api/v1/orders/${o.orderNumber}/cancel`, { method: "POST", body: { reason: "changed_mind", confirm: true, ...body }, jar, origin }), ctx({ id: o.orderNumber })));
const askReturn = (o: Ref, jar: Jar | null, body: Rec = {}, origin?: string) =>
  call(returnRoute(req(`/api/v1/orders/${o.orderNumber}/returns`, { method: "POST", body: { quantity: 1, reason: "quality", confirm: true, ...body }, jar, origin }), ctx({ id: o.orderNumber })));
const adminStatus = (o: Ref, status: string) => call(orderStatusRoute(req(`/api/v1/admin/orders/${o.orderNumber}/status`, { method: "PATCH", body: { status }, jar: admins.owner }), ctx({ id: o.orderNumber })));
const listReturns = (jar: Jar | null, query = "") => call(returnsRoute(req(`/api/v1/admin/returns${query}`, { jar }), ctx()));
const listCancellations = (jar: Jar | null) => call(cancellationsRoute(req("/api/v1/admin/cancellations", { jar }), ctx()));
const moveReturn = (id: string, status: string, jar: Jar | null, note = "", origin?: string) =>
  call(adminReturnRoute.PATCH(req(`/api/v1/admin/returns/${id}`, { method: "PATCH", body: { status, note }, jar, origin }), ctx({ id })));
const addNote = (id: string, text: string, jar: Jar | null) => call(returnNoteRoute(req(`/api/v1/admin/returns/${id}/notes`, { method: "POST", body: { text }, jar }), ctx({ id })));

async function customer(fullName = "Asha Menon") {
  const n = ++seq;
  const email = `shopper${n}@example.com`;
  const res = await register(req("/api/v1/auth/register", { method: "POST", body: { fullName, email, mobile: `98${String(10000000 + n)}`, password: "Kerala2026" } }), ctx());
  expect(res.status).toBe(201);
  gateway.emails = [];
  return { id: (await User.findOne({ email }).lean())!._id, email, jar: cookiesOf(res) };
}

const line = (key: keyof typeof product, quantity = 1, over: Rec = {}) => {
  const p = product[key];
  return { _id: new Types.ObjectId(), product: p._id, variantSku: p.sku, name: p.name, slug: p.slug, category: p.category, size: "M", color: "Rose", unitPricePaise: PRICE, mrpPaise: PRICE, quantity, lineTotalPaise: PRICE * quantity, ...over };
};

/** A paid order, its payment record, and the delivery entry when delivered. */
async function makeOrder(userId: Types.ObjectId | null, over: Rec = {}, deliveredAgo = HOUR) {
  const n = ++seq;
  const items = (over.items as ReturnType<typeof line>[]) ?? [line("kurti")];
  const total = items.reduce((s, i) => s + i.lineTotalPaise, 0);
  const paymentId = rid("pay");
  const status = (over.status as string) ?? "placed";
  const doc: Rec = {
    orderNumber: `MMAFT${String(n).padStart(5, "0")}`,
    user: userId,
    customer: { fullName: "Asha Menon", email: "typed-at-checkout@example.com", mobile: "9876543210" },
    shippingAddress: { house: "1 Test House", street: "MG Road", city: "Kochi", district: "Ernakulam", state: "Kerala", pincode: "682001", country: "India" },
    items,
    subtotalPaise: total,
    mrpTotalPaise: total,
    discountPaise: 0,
    totalPaise: total,
    paymentMethod: "upi",
    paymentStatus: "captured",
    razorpayPaymentId: paymentId,
    statusHistory: [{ status: "placed", at: new Date(Date.now() - 30 * DAY) }, ...(status === "delivered" ? [{ status: "delivered", at: new Date(Date.now() - deliveredAgo) }] : [])],
    ...over,
    status,
  };
  const order = (await Order.create(doc)) as unknown as { _id: Types.ObjectId; orderNumber: string; items: unknown };
  await Payment.create({ order: order._id, orderNumber: order.orderNumber, attempt: 1, user: userId, mode: "test", razorpayOrderId: rid("order"), razorpayPaymentId: paymentId, amountPaise: total, status: "captured" });
  return order;
}
const delivered = (userId: Types.ObjectId, over: Rec = {}, ago = HOUR) => makeOrder(userId, { status: "delivered", ...over }, ago);
const itemId = (o: { items: unknown }, i = 0) => String((o.items as { _id: unknown }[])[i]._id);
const stockOf = async (key: keyof typeof product) => (await Product.findById(product[key]._id).lean())!.variants[0].stock;

/** Everything cancellation and returns must not touch unless the existing rules say so. */
const money = async () =>
  JSON.stringify({
    orders: await Order.find({}, { status: 1, paymentStatus: 1, refundedPaise: 1, totalPaise: 1, statusHistory: 1 }).sort({ _id: 1 }).lean(),
    payments: await Payment.find({}, { status: 1, refundedPaise: 1, refunds: 1 }).sort({ _id: 1 }).lean(),
    stock: await Product.find({}, { variants: 1, soldCount: 1 }).sort({ _id: 1 }).lean(),
    movements: await InventoryMovement.countDocuments(),
    coupons: await Coupon.find().lean(),
    redemptions: await CouponRedemption.find().lean(),
  });

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  vi.stubEnv("MONGODB_URI", rs.getUri());
  vi.stubEnv("MONGODB_DB_NAME", "mm-after-sales-test");
  vi.stubEnv("JWT_ACCESS_SECRET", "a".repeat(48));
  vi.stubEnv("JWT_REFRESH_SECRET", "r".repeat(48));
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_AfterSales12");
  vi.stubEnv("RAZORPAY_KEY_SECRET", "after-sales-key-secret");
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", WEBHOOK_SECRET);
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("RESEND_API_KEY", "re_test_fake_key");
  vi.stubEnv("EMAIL_FROM", "M&M <orders@example.test>");
  resetEnvCache();
  await connectToDatabase();
  for (const m of Object.values(models)) {
    await m.createCollection();
    await m.syncIndexes();
  }
  for (const [key, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) await Role.create({ key, name: key, permissions: [...permissions] });
  vi.stubGlobal("fetch", fetchSpy);
  for (const key of ["owner", "manager", "staff"] as const) {
    const role = await Role.findOne({ key });
    await Admin.create({ name: `${key} admin`, email: `${key}@t.in`, passwordHash: await hashPassword(PW), role: role!._id });
    const res = await adminLogin(req("/api/v1/admin/auth/login", { method: "POST", body: { identifier: `${key}@t.in`, password: PW } }), ctx());
    expect(res.status).toBe(200);
    admins[key] = cookiesOf(res);
  }
}, 240_000);

beforeEach(async () => {
  await Promise.all([Order, Payment, Product, Category, User, ReturnRequest, InventoryMovement, Coupon, CouponRedemption, models.AuditLog, models.Cart, models.WebhookEvent].map((m) => (m as typeof Order).deleteMany({})));
  const women = (await Category.create({ slug: "kurtis", audience: "women", name: "Kurtis" }))._id;
  const nightwear = (await Category.create({ slug: "nightwear", audience: "women", name: "Nightwear" }))._id;
  for (const [key, name, category] of [["kurti", "Rose Kurti", women], ["dress", "Linen Dress", women], ["night", "Cotton Lounge Set", nightwear]] as const) {
    const sku = `MM-${key.toUpperCase()}-M`;
    const doc = await Product.create({ slug: `p-${key}`, name, sku: `MM-${key.toUpperCase()}`, audience: "women", category, status: "active", pricePaise: 0, mrpPaise: 0, soldCount: 5, variants: [{ sku, size: "M", color: { name: "Rose" }, pricePaise: PRICE, mrpPaise: PRICE, stock: 10 }] });
    product[key] = { _id: doc._id, id: String(doc._id), slug: `p-${key}`, sku, name, category };
  }
  gateway.payments.clear();
  gateway.refunds.clear();
  gateway.moneyCalls = [];
  gateway.emails = [];
  gateway.emailDown = false;
  resetRateLimits();
  fetchSpy.mockClear();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await disconnectFromDatabase();
  await rs?.stop();
  vi.unstubAllEnvs();
  resetEnvCache();
});

/* ---------- Rules ---------- */

describe("cancel button rules", () => {
  it("follows the order status", () => {
    const table: Record<StoreOrderStatus, string> = { "Order Placed": "on", Confirmed: "on", Processing: "on", Packed: "on", Shipped: "off", "Out for Delivery": "off", Delivered: "hidden", Cancelled: "hidden", Expired: "hidden", "Payment Failed": "hidden", "Payment Pending": "hidden" };
    for (const [status, want] of Object.entries(table)) expect([status, cancelAction(status as StoreOrderStatus)]).toEqual([status, want]);
  });

  it("offers exactly the requested reasons", () => {
    expect(Object.values(CANCEL_REASONS)).toEqual(["Ordered by mistake", "Found a better price elsewhere", "Delivery is taking too long", "Changed my mind", "Product no longer needed", "Ordered the wrong product / size / colour", "Other"]);
    expect(Object.values(RETURN_REASONS)).toEqual(["Received a damaged product", "Received a defective product", "Wrong product received", "Wrong size / colour received", "Product does not match the description", "Quality issue", "Other"]);
  });

  it("never describes an unfinished refund as refunded", () => {
    expect(refundMessage({ state: "pending", refunded: 0, processing: 0 })).toMatch(/^Refund pending: your payment has not been refunded yet/);
    expect(refundMessage({ state: "processing", refunded: 0, processing: 999 })).toMatch(/^Refund processing: ₹999 is on its way but not complete/);
    expect(refundMessage({ state: "refunded", refunded: 999, processing: 0 })).toMatch(/^Refunded/);
  });
});

describe("return eligibility, from the Return Policy", () => {
  const now = new Date("2026-11-28T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("uses the policy's published 7 days and 48 hours", () => {
    const html = renderToStaticMarkup(createElement(ReturnPolicyContent));
    expect(html).toContain(`within ${RETURN_WINDOW_DAYS} days of delivery`);
    expect(html).toContain(`within ${DAMAGE_CLAIM_HOURS} hours of delivery`);
    // The page and the return form show the same text.
    const page = renderToStaticMarkup(createElement(ReturnPolicyPage));
    for (const heading of ["Return window", "Eligibility", "Size exchanges", "How to request a return", "Refunds", "Damaged or incorrect items", "Unboxing video"]) {
      expect(html).toContain(`>${heading}</h2>`);
      expect(page).toContain(`>${heading}</h2>`);
    }
    expect(page).toContain('id="damaged-or-incorrect-items"');
  });

  it("opens every reason for 7 days after delivery, then closes", () => {
    expect(returnRules(null, ago(7 * DAY), now).reasons).toEqual(RETURN_REASON_KEYS);
    expect(returnRules(null, ago(7 * DAY + 1000), now)).toEqual({ reasons: [], message: "The 7-day return window has closed." });
    expect(returnRules(null, null, now).reasons).toEqual([]);
  });

  it("allows only damaged or wrong-item reports on non-returnable items, within 48 hours", () => {
    for (const kind of ["undergarment", "nightwear"] as const) {
      expect(returnRules(kind, ago(48 * HOUR), now).reasons).toEqual(["damaged", "wrong_product", "wrong_size_colour"]);
      expect(returnRules(kind, ago(48 * HOUR + 1000), now).reasons).toEqual([]);
    }
  });

  it("recognises nightwear by category or name, without catching other clothing", () => {
    expect(isNightwear("Cotton Lounge Set", ["nightwear"])).toBe(true);
    for (const name of ["Cotton Nightwear Set", "Satin Night Suit", "Printed Pyjama Set", "Floral Nighty"]) expect(isNightwear(name, [])).toBe(true);
    for (const name of ["Rose Kurti", "Midnight Blue Gown", "Premium Feeding Frock"]) expect(isNightwear(name, ["feeding-wear"])).toBe(false);
  });
});

/* ---------- Through the real checkout, cancellation and refund ---------- */

describe("a paid order, cancelled and refunded", () => {
  it("returns the stock once, keeps the coupon and payment rules, and shows refund progress truthfully", async () => {
    await Coupon.create({ code: "FLAT100", type: "flat", value: 10000, description: "Flat 100", startsAt: new Date(Date.now() - DAY) });
    const c = await customer();
    const jar = { ...c.jar };
    Object.assign(jar, cookiesOf(await addLine(req("/api/v1/cart/items", { method: "POST", body: { productId: product.kurti.id, size: "M", color: "Rose", quantity: 2 }, jar }), ctx())));
    const placed = await call(
      placeRoute(
        req("/api/v1/checkout/orders", {
          method: "POST",
          jar,
          body: {
            source: { type: "cart" },
            couponCode: "FLAT100",
            customer: { fullName: "Asha Menon", email: c.email, mobile: "9876543210" },
            address: { house: "1 Test House", street: "MG Road", city: "Kochi", district: "Ernakulam", state: "Kerala", pincode: "682001" },
            paymentMethod: "upi",
            idempotencyKey: `after-${Date.now()}-abcdefgh`,
            expectedTotalPaise: 2 * PRICE - 10000,
          },
        }),
        ctx(),
      ),
    );
    expect(placed.status, placed.body.message).toBe(201);
    const order = { orderNumber: placed.body.data.order.id as string };
    const started = await call(createPaymentRoute(req("/api/v1/payments/razorpay/create", { method: "POST", body: { orderId: order.orderNumber }, jar }), ctx()));
    const amount = 2 * PRICE - 10000;
    const payment = { id: rid("pay"), order_id: started.body.data.razorpayOrderId, amount, currency: "INR", status: "captured", method: "upi", international: false, captured: true, fee: 0, tax: 0 };
    gateway.payments.set(payment.id, { ...payment, amount_refunded: 0 });
    const webhook = (body: unknown) => {
      const raw = JSON.stringify(body);
      return call(webhookRoute(req("/api/v1/payments/razorpay/webhook", { method: "POST", raw, headers: { "x-razorpay-signature": createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex"), "x-razorpay-event-id": rid("evt") } }), ctx()));
    };
    expect((await webhook({ event: "payment.captured", payload: { payment: { entity: payment } } })).status).toBe(200);
    expect(await stockOf("kurti")).toBe(8);
    const couponBefore = JSON.stringify([await Coupon.find({}, { usageCount: 1 }).lean(), await CouponRedemption.find({}, { status: 1 }).lean()]);

    const r = await cancel(order, jar);
    expect(r.status, r.body.message).toBe(201);
    expect(r.body.data).toMatchObject({ orderStatus: "Cancelled", cancel: "hidden", refund: { state: "pending", refunded: 0, processing: 0 } });
    expect(await stockOf("kurti")).toBe(10);
    expect((await Product.findById(product.kurti._id).lean())!.variants[0].reserved).toBe(0);
    const ledger = await InventoryMovement.find({ type: "return" }).lean();
    expect(ledger.map((m) => [m.stockChange, m.actor.type])).toEqual([[2, "customer"]]);
    // Existing rules: a paid cancellation doesn't give the coupon use back, and refunds nothing.
    expect(JSON.stringify([await Coupon.find({}, { usageCount: 1 }).lean(), await CouponRedemption.find({}, { status: 1 }).lean()])).toBe(couponBefore);
    expect((await Order.findOne({ orderNumber: order.orderNumber }).lean())!).toMatchObject({ paymentStatus: "captured", refundedPaise: 0 });
    expect(gateway.moneyCalls).toEqual([]);

    // Staff refund through the existing workflow. Razorpay answers "pending" first.
    const record = (await Payment.findOne({ razorpayPaymentId: payment.id }).lean())!;
    const refunded = await call(refundRoute(req(`/api/v1/admin/payments/${record._id}/refunds`, { method: "POST", body: { reason: "Customer cancelled", idempotencyKey: `refund-${rid("k")}-abcdefgh` }, jar: admins.owner }), ctx({ id: String(record._id) })));
    expect(refunded.status, refunded.body.message).toBeLessThan(300);
    // The order record already says "refunded"; the customer is told it's still processing.
    expect((await Order.findOne({ orderNumber: order.orderNumber }).lean())!.paymentStatus).toBe("refunded");
    expect((await view(order, jar)).body.data.refund).toEqual({ state: "processing", refunded: 0, processing: amount / 100 });
    expect((await listCancellations(admins.manager)).body.data.items[0].refund.state).toBe("processing");

    const pending = [...gateway.refunds.values()][0];
    expect((await webhook({ event: "refund.processed", payload: { refund: { entity: { ...pending, status: "processed" } } } })).status).toBe(200);
    expect((await view(order, jar)).body.data.refund).toEqual({ state: "refunded", refunded: amount / 100, processing: 0 });
    expect(await stockOf("kurti")).toBe(10);
  });
});

/* ---------- Cancellation ---------- */

describe("customer cancellation", () => {
  it.each([["placed", "Order Placed"], ["confirmed", "Confirmed"], ["processing", "Processing"], ["packed", "Packed"]])("cancels a %s order and saves why", async (status, label) => {
    const c = await customer();
    const o = await makeOrder(c.id, { status });
    expect((await view(o, c.jar)).body.data).toMatchObject({ orderStatus: label, cancel: "on", cancellation: null });
    const started = Date.now();
    const r = await cancel(o, c.jar, { reason: "delivery_too_long", details: "  Needed it this week.  " });
    expect(r.status, r.body.message).toBe(201);
    expect(r.body.data.cancellation).toMatchObject({ reason: "Delivery is taking too long", otherReason: "", details: "Needed it this week." });
    const stored = (await Order.findById(o._id).lean())!;
    expect(stored.status).toBe("cancelled");
    expect(stored.cancellation).toMatchObject({ reason: "delivery_too_long", details: "Needed it this week.", statusAtRequest: status });
    expect(String(stored.cancellation!.customer)).toBe(String(c.id));
    expect(stored.cancellation!.requestedAt.getTime()).toBeGreaterThanOrEqual(started);
    expect(stored.statusHistory.at(-1)).toMatchObject({ from: status, status: "cancelled", note: "Cancelled by customer: Delivery is taking too long", by: { type: "customer" } });
    expect(stored.paymentStatus).toBe("captured");
    expect(await stockOf("kurti")).toBe(11);
  });

  it.each(["shipped", "out_for_delivery", "delivered"])("refuses a direct API call once the order is %s", async (status) => {
    const c = await customer();
    const o = await makeOrder(c.id, { status });
    const before = await money();
    const r = await cancel(o, c.jar);
    expect([r.status, r.body.message]).toEqual([409, "This order has shipped, so it can no longer be cancelled."]);
    expect(await money()).toBe(before);
    expect((await Order.findById(o._id).lean())!.cancellation).toBeNull();
  });

  it("applies as soon as an admin marks the order Shipped", async () => {
    const c = await customer();
    const o = await makeOrder(c.id, { status: "packed" });
    expect((await view(o, c.jar)).body.data.cancel).toBe("on");
    expect((await adminStatus(o, "Shipped")).status).toBe(200);
    expect((await view(o, c.jar)).body.data).toMatchObject({ orderStatus: "Shipped", cancel: "off" });
    expect((await cancel(o, c.jar)).status).toBe(409);
  });

  it.each(["pending_payment", "expired", "payment_failed"])("offers nothing and refuses a %s order, without calling Razorpay", async (status) => {
    const c = await customer();
    const o = await makeOrder(c.id, { status, paymentStatus: status === "payment_failed" ? "failed" : "pending" });
    expect((await view(o, c.jar)).body.data.cancel).toBe("hidden");
    const before = await money();
    expect((await cancel(o, c.jar)).status).toBe(409);
    expect(await money()).toBe(before);
    expect(fetchSpy.mock.calls.some(([u]) => String(u).includes("razorpay"))).toBe(false);
  });

  it("cancels once however many times it's sent, even at the same moment", async () => {
    const c = await customer();
    const o = await makeOrder(c.id, { items: [line("kurti", 3)] });
    const results = await Promise.all(Array.from({ length: 5 }, () => cancel(o, c.jar)));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    const again = await cancel(o, c.jar);
    expect([again.status, again.body.message]).toEqual([409, "This order has already been cancelled."]);
    expect(await stockOf("kurti")).toBe(13);
    expect(await InventoryMovement.countDocuments({ order: o._id, type: "return" })).toBe(1);
    expect((await Order.findById(o._id).lean())!.statusHistory.filter((h) => h.status === "cancelled")).toHaveLength(1);
    expect(gateway.emails).toHaveLength(1);
  });

  it("a cancellation and a 'Shipped' update at the same moment: exactly one wins", async () => {
    const c = await customer();
    for (let i = 0; i < 6; i++) {
      resetRateLimits();
      const o = await makeOrder(c.id, { status: "packed" });
      const stock = await stockOf("kurti");
      const [mine, theirs] = await Promise.all([cancel(o, c.jar), adminStatus(o, "Shipped")]);
      const final = (await Order.findById(o._id).lean())!;
      expect([mine.status === 201, theirs.status === 200].filter(Boolean)).toHaveLength(1);
      expect(final.status).toBe(mine.status === 201 ? "cancelled" : "shipped");
      expect(!!final.cancellation).toBe(mine.status === 201);
      expect(await stockOf("kurti")).toBe(stock + (mine.status === 201 ? 1 : 0));
    }
  });

  it("requires a reason, an explanation for Other, and confirmation", async () => {
    const c = await customer();
    const o = await makeOrder(c.id);
    for (const body of [{ reason: undefined }, { reason: "" }, { reason: "because" }, { reason: "other" }, { reason: "other", otherReason: "  " }, { confirm: undefined }, { confirm: false }, { confirm: "true" }, { details: "x".repeat(1001) }, { reason: "other", otherReason: "x".repeat(501) }]) {
      resetRateLimits();
      expect([body, (await cancel(o, c.jar, body)).status]).toEqual([body, 400]);
    }
    expect((await Order.findById(o._id).lean())!.status).toBe("placed");
    const r = await cancel(o, c.jar, { reason: "other", otherReason: "Moving house" });
    expect(r.status).toBe(201);
    expect(r.body.data.cancellation).toMatchObject({ reason: "Other", otherReason: "Moving house" });
  });

  it("ignores customer, status and money fields sent by the browser", async () => {
    const c = await customer();
    const o = await makeOrder(c.id);
    expect((await cancel(o, c.jar, { otherReason: "ignored unless Other", customer: String(new Types.ObjectId()), status: "delivered", statusAtRequest: "delivered", paymentStatus: "refunded", refundedPaise: PRICE })).status).toBe(201);
    const stored = (await Order.findById(o._id).lean())!;
    expect(stored).toMatchObject({ status: "cancelled", paymentStatus: "captured", refundedPaise: 0, cancellation: { otherReason: "", statusAtRequest: "placed" } });
    expect(String(stored.cancellation!.customer)).toBe(String(c.id));
  });

  it("only the signed-in owner can see or cancel an order", async () => {
    const owner = await customer();
    const other = await customer("Bala Nair");
    const o = await makeOrder(owner.id);
    const guestOrder = await makeOrder(null, { customer: { fullName: "Guest", email: other.email, mobile: "9876543210" } });
    for (const target of [o, guestOrder]) {
      for (const r of [await cancel(target, other.jar), await view(target, other.jar), await askReturn(target, other.jar, { itemId: itemId(target) })]) expect([r.status, r.body.message]).toEqual([404, "Order not found."]);
    }
    for (const jar of [null, admins.owner, { mm_access: "forged.token.value" }]) {
      expect((await cancel(o, jar)).status).toBe(401);
      expect((await view(o, jar)).status).toBe(401);
      expect((await askReturn(o, jar, { itemId: itemId(o) })).status).toBe(401);
    }
    expect((await cancel(o, owner.jar, {}, "https://evil.example")).status).toBe(403);
    await User.updateOne({ _id: owner.id }, { status: "blocked" });
    expect((await cancel(o, owner.jar)).status).toBe(403);
    expect(await Order.countDocuments({ status: "placed" })).toBe(2);
  });

  it("emails the account holder — and still cancels if email fails", async () => {
    const c = await customer();
    const o = await makeOrder(c.id);
    await cancel(o, c.jar);
    expect(gateway.emails).toHaveLength(1);
    expect(gateway.emails[0]).toMatchObject({ to: [c.email], subject: `Your order was cancelled — order ${o.orderNumber}` });
    expect(gateway.emails[0].text).toContain("refund is handled separately");
    gateway.emailDown = true;
    const second = await makeOrder(c.id);
    expect((await cancel(second, c.jar)).status).toBe(201);
  });

  it("shows staff the reason and details, on the order and in the cancellations list", async () => {
    const c = await customer();
    const o = await makeOrder(c.id, { status: "processing", items: [line("kurti", 2)] });
    await cancel(o, c.jar, { reason: "other", otherReason: "Found it locally", details: "No hurry on the refund." });
    const detail = await call(adminOrderRoute(req(`/api/v1/admin/orders/${o.orderNumber}`, { jar: admins.manager }), ctx({ id: o.orderNumber })));
    expect(detail.body.data.order.cancellation).toMatchObject({ reason: "Other", otherReason: "Found it locally", details: "No hurry on the refund.", statusAtRequest: "Processing" });
    for (const as of ["owner", "manager"] as const) {
      const list = (await listCancellations(admins[as])).body.data;
      expect(list.total).toBe(1);
      expect(list.items[0]).toMatchObject({ id: o.orderNumber, reason: "Other", otherReason: "Found it locally", details: "No hurry on the refund.", products: ["Rose Kurti (M) × 2"], statusAtRequest: "Processing", refund: { state: "pending" } });
    }
    // A staff cancellation records no customer reason.
    const byStaff = await makeOrder(c.id);
    expect((await adminStatus(byStaff, "Cancelled")).status).toBe(200);
    expect((await listCancellations(admins.owner)).body.data.total).toBe(1);
  });
});

/* ---------- Returns ---------- */

describe("return requests", () => {
  it("saves a request for a delivered item and changes nothing else", async () => {
    const c = await customer();
    const o = await delivered(c.id, { items: [line("kurti"), line("dress", 2)] });
    const before = await money();
    const first = (await view(o, c.jar)).body.data;
    expect(first.cancel).toBe("hidden");
    expect(first.lines.map((l: Rec) => [l.name, l.returnableQuantity, l.reasons.length])).toEqual([["Rose Kurti", 1, 7], ["Linen Dress", 2, 7]]);
    const r = await askReturn(o, c.jar, { itemId: itemId(o, 1), quantity: 2, reason: "not_as_described", explanation: "Colour differs", comments: "  Box was fine.  " });
    expect(r.status, r.body.message).toBe(201);
    expect(r.body.data.requests[0]).toMatchObject({ name: "Linen Dress", size: "M", color: "Rose", quantity: 2, reason: "Product does not match the description", explanation: "Colour differs", comments: "Box was fine.", status: "requested", statusLabel: "Return Requested" });
    const stored = (await ReturnRequest.findOne().lean())!;
    expect([String(stored.order), String(stored.user), String(stored.itemId), String(stored.product), stored.variantSku]).toEqual([String(o._id), String(c.id), itemId(o, 1), product.dress.id, product.dress.sku]);
    expect(stored.history).toMatchObject([{ status: "requested", by: { type: "customer" } }]);
    expect(stored.createdAt).toBeInstanceOf(Date);
    expect(await money()).toBe(before);
    expect((await Order.findById(o._id).lean())!.status).toBe("delivered");
    expect(gateway.moneyCalls).toEqual([]);
    expect(gateway.emails.map((m) => m.to[0])).toEqual([c.email]);
  });

  it.each(["placed", "confirmed", "processing", "packed", "shipped", "out_for_delivery", "cancelled"])("refuses a return while the order is %s", async (status) => {
    const c = await customer();
    const o = await makeOrder(c.id, { status });
    const r = await askReturn(o, c.jar, { itemId: itemId(o) });
    expect([r.status, r.body.message]).toEqual([403, "You can request a return only after the order is delivered."]);
    expect((await view(o, c.jar)).body.data.lines).toEqual([]);
    expect(await ReturnRequest.countDocuments()).toBe(0);
  });

  it("refuses outside the 7-day window and allows just inside it", async () => {
    const c = await customer();
    const late = await delivered(c.id, {}, 7 * DAY + 60_000);
    const r = await askReturn(late, c.jar, { itemId: itemId(late) });
    expect([r.status, r.body.message]).toEqual([403, "The 7-day return window has closed."]);
    expect((await view(late, c.jar)).body.data.lines[0]).toMatchObject({ returnableQuantity: 0, reasons: [] });
    const inTime = await delivered(c.id, {}, 7 * DAY - 60_000);
    expect((await askReturn(inTime, c.jar, { itemId: itemId(inTime) })).status).toBe(201);
  });

  it("can't judge an order with no delivery time, or one fully refunded", async () => {
    const c = await customer();
    const undated = await delivered(c.id);
    await Order.updateOne({ _id: undated._id }, { $set: { statusHistory: [] } });
    expect((await askReturn(undated, c.jar, { itemId: itemId(undated) })).body.message).toMatch(/couldn't confirm when this order was delivered/);
    const refunded = await delivered(c.id, { paymentStatus: "refunded", refundedPaise: PRICE });
    expect((await askReturn(refunded, c.jar, { itemId: itemId(refunded) })).status).toBe(403);
    const partly = await delivered(c.id, { paymentStatus: "partially_refunded", refundedPaise: 100 });
    expect((await askReturn(partly, c.jar, { itemId: itemId(partly) })).status).toBe(201);
  });

  it("applies the non-returnable rules to nightwear and undergarments", async () => {
    const c = await customer();
    const fresh = await delivered(c.id, { items: [line("night"), line("dress", 1, { name: "Cotton Nursing Bra" })] });
    for (const i of [0, 1]) {
      const r = await askReturn(fresh, c.jar, { itemId: itemId(fresh, i), reason: "quality" });
      expect(r.status).toBe(403);
      expect(r.body.message).toMatch(i === 0 ? /^Nightwear can't be returned/ : /^Undergarments can't be returned/);
    }
    expect((await askReturn(fresh, c.jar, { itemId: itemId(fresh, 0), reason: "damaged" })).status).toBe(201);
    expect((await ReturnRequest.findOne().lean())!.withinClaimWindow).toBe(true);
    const older = await delivered(c.id, { items: [line("night")] }, 49 * HOUR);
    expect((await askReturn(older, c.jar, { itemId: itemId(older), reason: "damaged" })).body.message).toMatch(/48-hour period .* has passed/);
    // An ordinary item reported damaged later is accepted for staff to judge, and marked as late.
    const ordinary = await delivered(c.id, {}, 3 * DAY);
    expect((await askReturn(ordinary, c.jar, { itemId: itemId(ordinary), reason: "damaged" })).status).toBe(201);
    expect((await ReturnRequest.findOne({ order: ordinary._id }).lean())!.withinClaimWindow).toBe(false);
  });

  it("handles several products and quantities, never more than were bought", async () => {
    const c = await customer();
    const o = await delivered(c.id, { items: [line("kurti", 3), line("dress")] });
    expect((await askReturn(o, c.jar, { itemId: itemId(o, 0), quantity: 4 })).status).toBe(409);
    expect((await askReturn(o, c.jar, { itemId: itemId(o, 0), quantity: 2 })).status).toBe(201);
    expect((await view(o, c.jar)).body.data.lines.map((l: Rec) => l.returnableQuantity)).toEqual([1, 1]);
    expect((await askReturn(o, c.jar, { itemId: itemId(o, 0), quantity: 2 })).body.message).toBe("You can request a return for 1 of this item.");
    expect((await askReturn(o, c.jar, { itemId: itemId(o, 0), quantity: 1 })).status).toBe(201);
    expect((await askReturn(o, c.jar, { itemId: itemId(o, 1) })).status).toBe(201);
    const after = (await view(o, c.jar)).body.data;
    expect(after.lines.map((l: Rec) => l.returnableQuantity)).toEqual([0, 0]);
    expect(after.requests).toHaveLength(3);
  });

  it("refuses duplicates, including after rejection and at the same moment", async () => {
    const c = await customer();
    const o = await delivered(c.id);
    const results = await Promise.all(Array.from({ length: 5 }, () => askReturn(o, c.jar, { itemId: itemId(o) })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    const id = String((await ReturnRequest.findOne().lean())!._id);
    await moveReturn(id, "rejected", admins.owner);
    const again = await askReturn(o, c.jar, { itemId: itemId(o) });
    expect([again.status, again.body.message]).toEqual([409, "A return has already been requested for this item."]);
    expect(await ReturnRequest.countDocuments()).toBe(1);
  });

  it("only accepts lines from that order", async () => {
    const c = await customer();
    const o = await delivered(c.id);
    const elsewhere = await delivered(c.id, { items: [line("dress")] });
    for (const id of [itemId(elsewhere), String(new Types.ObjectId()), product.kurti.id]) {
      const r = await askReturn(o, c.jar, { itemId: id });
      expect([r.status, r.body.message]).toEqual([403, "That product isn't part of this order."]);
    }
  });

  it("requires a reason, an explanation for Other, a whole quantity and confirmation", async () => {
    const c = await customer();
    const o = await delivered(c.id);
    for (const body of [{ reason: undefined }, { reason: "bored" }, { reason: "other" }, { reason: "other", explanation: " " }, { quantity: 0 }, { quantity: 1.5 }, { quantity: "1" }, { confirm: false }, { confirm: undefined }, { itemId: "nope" }, { comments: "x".repeat(1001) }]) {
      resetRateLimits();
      expect([body, (await askReturn(o, c.jar, { itemId: itemId(o), ...body })).status]).toEqual([body, 400]);
    }
    expect((await askReturn(o, c.jar, { itemId: itemId(o), reason: "other", explanation: "Gift not needed", status: "approved" })).status).toBe(201);
    expect((await ReturnRequest.findOne().lean())!.status).toBe("requested");
  });
});

/* ---------- Admin ---------- */

describe("admin return management", () => {
  async function request() {
    const c = await customer();
    const o = await delivered(c.id);
    await askReturn(o, c.jar, { itemId: itemId(o), reason: "defective", explanation: "Seam open", comments: "See left side." });
    gateway.emails = [];
    return { ...c, order: o, id: String((await ReturnRequest.findOne({ order: o._id }).lean())!._id) };
  }

  it("lists requests with the order, product, reason and comments", async () => {
    const r = await request();
    for (const as of ["owner", "manager"] as const) {
      const list = (await listReturns(admins[as])).body.data;
      expect(list.items[0]).toMatchObject({ orderNumber: r.order.orderNumber, name: "Rose Kurti", sku: product.kurti.sku, reason: "Received a defective product", explanation: "Seam open", comments: "See left side.", status: "requested", allowedStatuses: ["approved", "rejected"], refund: { state: "pending" } });
    }
    expect((await listReturns(admins.owner, "?status=approved")).body.data.total).toBe(0);
    expect((await listReturns(admins.owner, `?order=${r.order.orderNumber}`)).body.data.total).toBe(1);
    expect((await listReturns(admins.owner, "?status=refunded")).status).toBe(400);
  });

  it("approves and completes through the allowed steps, with history, notes and emails — and no money or stock changes", async () => {
    const r = await request();
    const before = await money();
    expect((await moveReturn(r.id, "completed", admins.manager)).status).toBe(409);
    expect((await moveReturn(r.id, "processing", admins.manager)).status).toBe(409);
    const approved = await moveReturn(r.id, "approved", admins.manager, "SECRET-APPROVAL-NOTE");
    expect(approved.body.data).toMatchObject({ status: "approved", statusLabel: "Return Approved", allowedStatuses: ["processing", "rejected"] });
    expect((await addNote(r.id, "SECRET-SECOND-NOTE", admins.owner)).status).toBe(200);
    expect((await moveReturn(r.id, "processing", admins.owner)).status).toBe(200);
    const done = (await moveReturn(r.id, "completed", admins.owner)).body.data;
    expect(done.allowedStatuses).toEqual([]);
    expect(done.history.map((h: Rec) => [h.status, h.by])).toEqual([["Return Requested", "Asha Menon"], ["Return Approved", "manager admin"], ["Return Processing", "owner admin"], ["Return Completed", "owner admin"]]);
    expect(done.adminNotes.map((n: Rec) => [n.text, n.author])).toEqual([["SECRET-APPROVAL-NOTE", "manager admin"], ["SECRET-SECOND-NOTE", "owner admin"]]);
    expect((await moveReturn(r.id, "rejected", admins.owner)).status).toBe(409);
    expect(await money()).toBe(before);
    expect(gateway.moneyCalls).toEqual([]);
    expect(gateway.emails.map((m) => m.subject.split(" — ")[0])).toEqual(["Return Approved", "Return Processing", "Return Completed"]);
    expect(JSON.stringify(gateway.emails)).not.toContain("SECRET");
    expect((await models.AuditLog.countDocuments({ action: "return.status" }))).toBe(3);

    const mine = await view(r.order, r.jar);
    expect(mine.body.data.requests[0]).toMatchObject({ statusLabel: "Return Completed", reason: "Received a defective product" });
    expect(mine.body.data.requests[0].history.map((h: Rec) => h.status)).toEqual(["Return Requested", "Return Approved", "Return Processing", "Return Completed"]);
    // Completing a return doesn't claim a refund.
    expect(mine.body.data.refund).toBeNull();
    const orderView = await call(customerOrderRoute(req(`/api/v1/orders/${r.order.orderNumber}`, { jar: r.jar }), ctx({ id: r.order.orderNumber })));
    for (const response of [mine, orderView]) {
      const text = JSON.stringify(response.body);
      for (const secret of ["SECRET", "adminNotes", "owner admin", "manager admin"]) expect(text).not.toContain(secret);
    }
  });

  it("rejects a request, and only one of two simultaneous decisions wins", async () => {
    const r = await request();
    const rejected = await moveReturn(r.id, "rejected", admins.owner);
    expect(rejected.body.data).toMatchObject({ statusLabel: "Return Rejected", allowedStatuses: [] });
    const again = await request();
    const results = await Promise.all([moveReturn(again.id, "approved", admins.owner), moveReturn(again.id, "rejected", admins.manager)]);
    expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
    expect((await ReturnRequest.findById(again.id).lean())!.history).toHaveLength(2);
  });

  it("is open to Owner and Manager only", async () => {
    const r = await request();
    for (const [jar, status] of [[null, 401], [r.jar, 401], [admins.staff, 403]] as const) {
      expect((await listReturns(jar)).status).toBe(status);
      expect((await listCancellations(jar)).status).toBe(status);
      expect((await moveReturn(r.id, "approved", jar)).status).toBe(status);
      expect((await addNote(r.id, "x", jar)).status).toBe(status);
    }
    expect((await moveReturn(r.id, "approved", admins.owner, "", "https://evil.example")).status).toBe(403);
    expect((await ReturnRequest.findById(r.id).lean())!.status).toBe("requested");
    expect(["owner", "manager", "staff"].map((k) => DEFAULT_ROLE_PERMISSIONS[k as As].includes("payments:refund"))).toEqual([true, true, false]);
    await Role.updateOne({ key: "manager" }, { $pull: { permissions: "payments:refund" } });
    try {
      expect((await listReturns(admins.manager)).status).toBe(403);
    } finally {
      await Role.updateOne({ key: "manager" }, { $addToSet: { permissions: "payments:refund" } });
    }
  });

  it("has no way to delete or rewrite a request, and appears in the navigation", () => {
    expect(Object.keys(adminReturnRoute).filter((k) => /^[A-Z]+$/.test(k))).toEqual(["PATCH"]);
    expect(ADMIN_NAV.flatMap((g) => g.items.map((i) => i.href))).toContain("/mm-hub/returns");
  });
});
