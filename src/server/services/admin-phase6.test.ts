import { MongoMemoryReplSet } from "mongodb-memory-server";
import { Types } from "mongoose";
import { NextRequest, type NextResponse } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login } from "@/app/api/v1/admin/auth/login/route";
import { GET as getCustomerRoute, PATCH as patchCustomer } from "@/app/api/v1/admin/customers/[id]/route";
import { GET as listCustomersRoute } from "@/app/api/v1/admin/customers/route";
import { GET as getSettingsRoute, PATCH as patchSettingsRoute } from "@/app/api/v1/admin/settings/route";
import { PATCH as patchShippingRoute } from "@/app/api/v1/admin/settings/shipping/route";
import { POST as createBannerRoute } from "@/app/api/v1/admin/banners/route";
import { DELETE as deleteBannerRoute, PATCH as patchBannerRoute } from "@/app/api/v1/admin/banners/[id]/route";
import { POST as moveBannerRoute } from "@/app/api/v1/admin/banners/[id]/move/route";
import { GET as getHomepageRoute } from "@/app/api/v1/admin/homepage/route";
import { PUT as featuredRoute } from "@/app/api/v1/admin/homepage/featured/route";
import { PATCH as sectionsRoute } from "@/app/api/v1/admin/homepage/sections/route";
import { GET as listCouponsRoute, POST as createCouponRoute } from "@/app/api/v1/admin/coupons/route";
import { DELETE as deleteCouponRoute, PATCH as patchCouponRoute } from "@/app/api/v1/admin/coupons/[id]/route";
import { GET as couponUsageRoute } from "@/app/api/v1/admin/coupons/[id]/usage/route";
import { GET as listOffersRoute, POST as createOfferRoute } from "@/app/api/v1/admin/offers/route";
import { DELETE as deleteOfferRoute, PATCH as patchOfferRoute } from "@/app/api/v1/admin/offers/[id]/route";
import { GET as getPaymentRoute } from "@/app/api/v1/admin/payments/[id]/route";
import { POST as refundRoute } from "@/app/api/v1/admin/payments/[id]/refunds/route";
import { POST as syncRefundRoute } from "@/app/api/v1/admin/payments/[id]/refunds/[refundId]/route";
import { GET as listPaymentsRoute } from "@/app/api/v1/admin/payments/route";
import { POST as webhookRoute } from "@/app/api/v1/payments/razorpay/webhook/route";
import { POST as bulkRoute } from "@/app/api/v1/admin/orders/bulk-status/route";
import { POST as noteRoute } from "@/app/api/v1/admin/orders/[id]/notes/route";
import { GET as getOrderRoute } from "@/app/api/v1/admin/orders/[id]/route";
import { PATCH as orderStatusRoute } from "@/app/api/v1/admin/orders/[id]/status/route";
import { PUT as trackingRoute } from "@/app/api/v1/admin/orders/[id]/tracking/route";
import { GET as listOrdersRoute } from "@/app/api/v1/admin/orders/route";
import { DEFAULT_ROLE_PERMISSIONS } from "@/server/auth/permissions";
import { hashPassword } from "@/server/auth/password";
import { resetEnvCache } from "@/server/config/env";
import { connectToDatabase, disconnectFromDatabase } from "@/server/db/connect";
import * as models from "@/server/models";
import { Admin, AuditLog, Category, Order, Product, Role, Session, User } from "@/server/models";
import { resetRateLimits } from "@/server/security/rate-limit";

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }));

/* ---------- Harness ---------- */

const ORIGIN = "http://localhost:3000";
const PW = "Correct-horse-42";
let rs: MongoMemoryReplSet;
type Jar = Record<string, string>;
type As = "owner" | "manager" | "staff" | "none";
const jars: Partial<Record<As, Jar>> = {};

function req(path: string, init: { method?: string; body?: unknown; as?: As; origin?: string | null } = {}) {
  const headers: Record<string, string> = {};
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const jar = jars[init.as ?? "owner"];
  if (jar) headers.cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
  return new NextRequest(`${ORIGIN}${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}
const p = <T extends Record<string, string>>(params: T = {} as T) => ({ params: Promise.resolve(params) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = { success: boolean; message: string; data: any; error?: { code: string; issues?: { path: string }[] } };
const call = async (res: Response | Promise<Response>) => {
  const r = await res;
  return { status: r.status, body: (await r.json()) as Body };
};

/* ---------- Fixtures ---------- */

let seq = 0;
async function makeCustomer(over: Record<string, unknown> = {}) {
  seq += 1;
  return User.create({
    fullName: `Customer ${seq}`,
    email: `customer${seq}@example.com`,
    mobile: `98${String(10000000 + seq).padStart(8, "0")}`,
    passwordHash: "$2a$12$abcdefghijklmnopqrstuvabcdefghijklmnopqrstuvwxyzabcde",
    addresses: [{ label: "Home", address: { house: "1 Test House", street: "MG Road", city: "Kochi", district: "Ernakulam", state: "Kerala", pincode: "682001" }, isDefault: true }],
    ...over,
  });
}

let productId: Types.ObjectId;
let categoryId: Types.ObjectId;
const ADDRESS = { house: "1 Test House", street: "MG Road", city: "Kochi", district: "Ernakulam", state: "Kerala", pincode: "682001", country: "India" as const };

async function makeOrder(over: Record<string, unknown> = {}) {
  seq += 1;
  const total = (over.totalPaise as number) ?? 129900;
  return Order.create({
    orderNumber: `MMTEST${String(seq).padStart(4, "0")}`,
    user: null,
    customer: { fullName: "Guest Buyer", email: "guest@example.com", mobile: "9876543210" },
    shippingAddress: ADDRESS,
    items: [
      {
        product: productId,
        variantSku: "MM-K1-M-ROSE",
        name: "Rose Kurti",
        slug: "rose-kurti",
        category: categoryId,
        size: "M",
        color: "Rose",
        unitPricePaise: total,
        mrpPaise: total,
        quantity: 1,
        lineTotalPaise: total,
      },
    ],
    subtotalPaise: total,
    mrpTotalPaise: total,
    discountPaise: 0,
    totalPaise: total,
    paymentMethod: "upi",
    status: "placed",
    paymentStatus: "captured",
    statusHistory: [{ status: "pending_payment", at: new Date() }, { status: "placed", at: new Date() }],
    ...over,
  });
}

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  vi.stubEnv("MONGODB_URI", rs.getUri());
  vi.stubEnv("MONGODB_DB_NAME", "mm-admin-phase6-test");
  vi.stubEnv("JWT_ACCESS_SECRET", "a".repeat(48));
  vi.stubEnv("JWT_REFRESH_SECRET", "r".repeat(48));
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("RESEND_API_KEY", "");
  resetEnvCache();
  await connectToDatabase();
  for (const m of Object.values(models)) {
    await m.createCollection();
    await m.syncIndexes();
  }
  for (const [key, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) await Role.create({ key, name: key, permissions: [...permissions] });
  for (const key of ["owner", "manager", "staff"] as const) {
    const role = await Role.findOne({ key });
    await Admin.create({ name: `${key} admin`, email: `${key}@t.in`, passwordHash: await hashPassword(PW), role: role!._id });
    const res = await login(req("/api/v1/admin/auth/login", { method: "POST", body: { identifier: `${key}@t.in`, password: PW }, as: "none" }), p());
    expect(res.status).toBe(200);
    jars[key] = Object.fromEntries((res as NextResponse).cookies.getAll().map((c) => [c.name, c.value]));
  }
  categoryId = (await Category.create({ slug: "kurtis", audience: "women", name: "Kurtis" }))._id;
  productId = (
    await Product.create({
      slug: "rose-kurti", name: "Rose Kurti", sku: "MM-K1", audience: "women", category: categoryId, status: "active", pricePaise: 0, mrpPaise: 0,
      variants: [{ sku: "MM-K1-M-ROSE", size: "M", color: { name: "Rose" }, pricePaise: 129900, mrpPaise: 129900, stock: 10 }],
    })
  )._id;
}, 240_000);

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Order.deleteMany({}), AuditLog.deleteMany({})]);
  await Session.deleteMany({ subjectType: "user" });
  resetRateLimits();
});

afterAll(async () => {
  await disconnectFromDatabase();
  await rs?.stop();
  vi.unstubAllEnvs();
  resetEnvCache();
});

/* ---------- Module 1: Customers ---------- */

describe("admin customers", () => {
  it("enforces sign-in and permissions (staff can read, only customers:write can change)", async () => {
    const c = await makeCustomer();
    expect((await call(listCustomersRoute(req("/api/v1/admin/customers", { as: "none" }), p()))).status).toBe(401);
    for (const as of ["owner", "manager", "staff"] as const) expect((await call(listCustomersRoute(req("/api/v1/admin/customers", { as }), p()))).status).toBe(200);
    const patch = (as: As) => call(patchCustomer(req(`/api/v1/admin/customers/${c.id}`, { method: "PATCH", body: { status: "blocked" }, as }), p({ id: c.id })));
    expect((await patch("staff")).status).toBe(403);
    expect((await patch("manager")).status).toBe(200);
    const crossSite = await call(patchCustomer(req(`/api/v1/admin/customers/${c.id}`, { method: "PATCH", body: { status: "active" }, origin: "https://evil.example" }), p({ id: c.id })));
    expect(crossSite.status).toBe(403);
  });

  it("lists with real order figures, never exposing secrets", async () => {
    const a = await makeCustomer({ fullName: "Anitha Menon" });
    const b = await makeCustomer({ fullName: "Bala Kumar" });
    await makeOrder({ user: a._id, totalPaise: 600000 });
    await makeOrder({ user: a._id, totalPaise: 500000, refundedPaise: 100000, paymentStatus: "partially_refunded" });
    await makeOrder({ user: a._id, totalPaise: 999900, status: "expired", paymentStatus: "pending" }); // unpaid: not counted
    await makeOrder({ user: b._id, totalPaise: 129900 });

    const r = await call(listCustomersRoute(req("/api/v1/admin/customers?sort=spent&dir=desc"), p()));
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ total: 2, page: 1, totalPages: 1, segments: { all: 2, repeat: 1, vip: 1, blocked: 0, new: 2 } });
    const first = r.body.data.items[0];
    expect(first).toMatchObject({ fullName: "Anitha Menon", orderCount: 2, totalSpent: 10000, status: "active", addresses: [{ city: "Kochi" }] });
    const raw = JSON.stringify(r.body);
    for (const secret of ["passwordHash", "$2a$", "passwordReset", "failedLoginCount", "lockedUntil"]) expect(raw).not.toContain(secret);
  });

  it("searches by name, email and mobile, filters by status, segment and joined date, and paginates", async () => {
    const old = await makeCustomer({ fullName: "Old Timer", createdAt: new Date("2024-01-15") });
    await makeCustomer({ fullName: "Priya Nair", email: "priya.nair@example.com" });
    await makeCustomer({ fullName: "Blocked Person", status: "blocked" });
    for (let i = 0; i < 4; i++) await makeCustomer();

    const list = async (qs: string) => (await call(listCustomersRoute(req(`/api/v1/admin/customers?${qs}`), p()))).body.data;
    expect((await list("q=priya")).items.map((c: { fullName: string }) => c.fullName)).toEqual(["Priya Nair"]);
    expect((await list("q=PRIYA.NAIR@EXAMPLE")).total).toBe(1);
    expect((await list(`q=${old.mobile}`)).items[0].fullName).toBe("Old Timer");
    expect((await list("q=.*")).total).toBe(0); // regex characters are literal
    expect((await list("status=blocked")).items.map((c: { fullName: string }) => c.fullName)).toEqual(["Blocked Person"]);
    expect((await list("segment=blocked")).total).toBe(1);
    expect((await list("to=2024-12-31")).items.map((c: { fullName: string }) => c.fullName)).toEqual(["Old Timer"]);
    expect((await list("segment=new")).total).toBe(6);
    const page1 = await list("limit=3&page=1&sort=name&dir=asc");
    const page3 = await list("limit=3&page=3&sort=name&dir=asc");
    expect([page1.items.length, page1.totalPages, page3.items.length]).toEqual([3, 3, 1]);
    expect((await call(listCustomersRoute(req("/api/v1/admin/customers?limit=1000"), p()))).status).toBe(400);
    expect((await call(listCustomersRoute(req("/api/v1/admin/customers?segment=everyone"), p()))).status).toBe(400);
  });

  it("shows a profile with addresses and order history", async () => {
    const c = await makeCustomer({ adminNotes: "Prefers WhatsApp" });
    await makeOrder({ user: c._id });
    await makeOrder({ user: c._id, status: "pending_payment", paymentStatus: "pending" });
    const r = await call(getCustomerRoute(req(`/api/v1/admin/customers/${c.id}`, { as: "staff" }), p({ id: c.id })));
    expect(r.status).toBe(200);
    expect(r.body.data.customer).toMatchObject({ notes: "Prefers WhatsApp", orderCount: 1, totalSpent: 1299 });
    expect(r.body.data.orders.map((o: { status: string }) => o.status).sort()).toEqual(["Order Placed", "Payment Pending"]);
    expect(r.body.data.orderTotal).toBe(2);
    expect((await call(getCustomerRoute(req(`/api/v1/admin/customers/${new Types.ObjectId()}`), p({ id: String(new Types.ObjectId()) })))).status).toBe(404);
    expect((await call(getCustomerRoute(req("/api/v1/admin/customers/nope"), p({ id: "nope" })))).status).toBe(400);
  });

  it("blocking signs the customer out everywhere and is audited; notes are validated and audited", async () => {
    const c = await makeCustomer();
    await Session.create({ subjectType: "user", subject: c._id, subjectModel: "User", refreshTokenHash: "x".repeat(64), familyId: "f1", expiresAt: new Date(Date.now() + 86_400_000) });
    const block = await call(patchCustomer(req(`/api/v1/admin/customers/${c.id}`, { method: "PATCH", body: { status: "blocked" } }), p({ id: c.id })));
    expect(block.body.data.customer.status).toBe("blocked");
    expect(await Session.countDocuments({ subject: c._id, revokedAt: null })).toBe(0);
    expect(await AuditLog.findOne({ action: "customer.block", "entity.id": c.id }).lean()).toMatchObject({ actor: { name: "owner admin" }, changes: { status: { from: "active", to: "blocked" } } });

    await call(patchCustomer(req(`/api/v1/admin/customers/${c.id}`, { method: "PATCH", body: { status: "active" } }), p({ id: c.id })));
    expect(await AuditLog.countDocuments({ action: "customer.unblock" })).toBe(1);

    const notes = await call(patchCustomer(req(`/api/v1/admin/customers/${c.id}`, { method: "PATCH", body: { notes: "VIP — gift wrap" } }), p({ id: c.id })));
    expect(notes.body.data.customer.notes).toBe("VIP — gift wrap");
    expect(await AuditLog.countDocuments({ action: "customer.notes" })).toBe(1);

    for (const body of [{}, { status: "deleted" }, { notes: "x".repeat(2001) }]) {
      expect((await call(patchCustomer(req(`/api/v1/admin/customers/${c.id}`, { method: "PATCH", body }), p({ id: c.id })))).status).toBe(400);
    }
    // No-op updates don't write audit entries.
    await call(patchCustomer(req(`/api/v1/admin/customers/${c.id}`, { method: "PATCH", body: { status: "active" } }), p({ id: c.id })));
    expect(await AuditLog.countDocuments({ action: { $in: ["customer.block", "customer.unblock"] } })).toBe(2);
  });
});

/* ---------- Module 2: Orders ---------- */

describe("admin orders", () => {
  const variant = async () => {
    const p = await Product.findById(productId, { variants: 1, soldCount: 1 }).lean();
    return { ...p!.variants[0], soldCount: p!.soldCount };
  };
  const setStock = (stock: number, reserved = 0) => Product.updateOne({ _id: productId }, { $set: { "variants.0.stock": stock, "variants.0.reserved": reserved, soldCount: 5 } });
  const status = (id: string, body: Record<string, unknown>, as: As = "owner") =>
    call(orderStatusRoute(req(`/api/v1/admin/orders/${id}/status`, { method: "PATCH", body, as }), p({ id })));
  const tracking = (id: string, body: Record<string, unknown>) => call(trackingRoute(req(`/api/v1/admin/orders/${id}/tracking`, { method: "PUT", body }), p({ id })));

  beforeEach(async () => {
    await Promise.all([models.InventoryMovement.deleteMany({}), models.Payment.deleteMany({}), models.CouponRedemption.deleteMany({})]);
    await setStock(10);
  });

  it("enforces sign-in and permissions", async () => {
    const o = await makeOrder();
    expect((await call(listOrdersRoute(req("/api/v1/admin/orders", { as: "none" }), p()))).status).toBe(401);
    expect((await call(getOrderRoute(req(`/api/v1/admin/orders/${o.orderNumber}`, { as: "staff" }), p({ id: o.orderNumber })))).status).toBe(200);
    expect((await status(o.orderNumber, { status: "Confirmed" }, "staff")).status).toBe(200); // staff hold orders:write
    expect((await status(o.orderNumber, { status: "Processing" }, "none")).status).toBe(401);
    const crossSite = await call(orderStatusRoute(req(`/api/v1/admin/orders/${o.orderNumber}/status`, { method: "PATCH", body: { status: "Processing" }, origin: "https://evil.example" }), p({ id: o.orderNumber })));
    expect(crossSite.status).toBe(403);
  });

  it("searches, filters, counts and paginates", async () => {
    const c = await makeCustomer({ fullName: "Divya Raj" });
    const a = await makeOrder({ user: c._id, customer: { fullName: "Divya Raj", email: "divya@example.com", mobile: "9123456789" }, totalPaise: 250000 });
    await makeOrder({ status: "pending_payment", paymentStatus: "pending" });
    await makeOrder({ status: "shipped", createdAt: new Date("2024-03-01"), paymentMethod: "card" });
    await makeOrder({ paymentStatus: "partially_refunded", refundedPaise: 29900 });
    const list = async (qs: string) => (await call(listOrdersRoute(req(`/api/v1/admin/orders?${qs}`), p()))).body.data;

    const all = await list("");
    expect(all.total).toBe(4);
    expect(all.counts).toMatchObject({ all: 4, "Order Placed": 2, "Payment Pending": 1, Shipped: 1 });
    expect(all.revenue).toBe(2500 + 1299 + 1299 - 299); // paid, net of refunds; unpaid excluded
    expect((await list(`q=${a.orderNumber.slice(0, 8)}`)).items.map((o: { id: string }) => o.id)).toContain(a.orderNumber);
    expect((await list("q=divya")).total).toBe(1);
    expect((await list("q=DIVYA@EXAMPLE.COM")).total).toBe(1);
    expect((await list("q=23456789")).total).toBe(1);
    expect((await list("q=(")).total).toBe(0);
    expect((await list("status=Payment%20Pending")).total).toBe(1);
    expect((await list("paymentStatus=partially_refunded")).total).toBe(1);
    expect((await list("method=card")).total).toBe(1);
    expect((await list("to=2024-12-31")).total).toBe(1);
    expect((await list(`customer=${c.id}`)).items[0]).toMatchObject({ id: a.orderNumber, customerId: c.id, guest: false });
    const page = await list("limit=3&page=2&sort=total&dir=desc");
    expect([page.items.length, page.totalPages]).toEqual([1, 2]);
    for (const bad of ["status=Paid", "paymentStatus=paid", "limit=0", "from=not-a-date"]) {
      expect((await call(listOrdersRoute(req(`/api/v1/admin/orders?${bad}`), p()))).status).toBe(400);
    }
  });

  it("allows only valid, forward fulfilment moves on paid orders and never touches payment", async () => {
    const o = await makeOrder();
    const id = o.orderNumber;
    expect((await status(id, { status: "Delivered" })).status).toBe(409); // no skipping past shipping
    expect((await status(id, { status: "Order Placed" })).status).toBe(400); // not a settable status
    expect((await status(id, { status: "Paid" })).status).toBe(400);
    expect((await status(id, { paymentStatus: "captured" })).status).toBe(400);

    const confirmed = await status(id, { status: "Confirmed", note: "Packed today" });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.order).toMatchObject({ status: "Confirmed", paymentStatus: "captured" });
    expect(confirmed.body.data.order.timeline.at(-1)).toMatchObject({ status: "Confirmed", by: "owner admin", note: "Packed today" });
    expect(confirmed.body.data.order.allowedTransitions).toEqual(["Processing", "Shipped", "Cancelled"]);

    expect((await status(id, { status: "Shipped" })).status).toBe(400); // needs tracking first
    expect((await tracking(id, { courier: "Delhivery", awb: "DL 123" })).status).toBe(400);
    expect((await tracking(id, { courier: "Delhivery", awb: "DL123", url: "http://insecure.example/x" })).status).toBe(400);
    expect((await tracking(id, { courier: "Delhivery", awb: "dl123456", url: "https://track.example/dl123456" })).body.data.order.tracking).toMatchObject({ courier: "Delhivery", awb: "DL123456" });
    const shipped = await status(id, { status: "Shipped" });
    expect(shipped.body.data.order.tracking.shippedAt).toBeTruthy();
    expect((await status(id, { status: "Cancelled" })).status).toBe(409); // too late to cancel
    expect((await status(id, { status: "Delivered" })).status).toBe(200);
    expect((await status(id, { status: "Out for Delivery" })).status).toBe(409); // never backwards

    expect(await AuditLog.countDocuments({ action: "order.status", "entity.id": id })).toBe(3);
    expect(await AuditLog.countDocuments({ action: "order.tracking", "entity.id": id })).toBe(1);
    expect((await Order.findById(o._id).lean())!.paymentStatus).toBe("captured");

    const unpaid = await makeOrder({ status: "pending_payment", paymentStatus: "pending" });
    expect((await status(unpaid.orderNumber, { status: "Confirmed" })).status).toBe(409);
    expect((await tracking(unpaid.orderNumber, { courier: "Delhivery", awb: "DL1" })).status).toBe(409);
  });

  it("cancelling a paid, unshipped order puts its units back in stock exactly once", async () => {
    const o = await makeOrder();
    const r = await status(o.orderNumber, { status: "Cancelled", note: "Customer changed mind" });
    expect(r.status).toBe(200);
    expect(r.body.data.order).toMatchObject({ status: "Cancelled", paymentStatus: "captured" }); // refund is a separate step
    expect(await variant()).toMatchObject({ stock: 11, reserved: 0, soldCount: 4 });
    const ledger = await models.InventoryMovement.find({ order: o._id }).lean();
    expect(ledger.map((m) => [m.type, m.stockChange, m.stockAfter, m.actor.type])).toEqual([["return", 1, 11, "admin"]]);
    expect((await status(o.orderNumber, { status: "Cancelled" })).status).toBe(409);
    expect(await variant()).toMatchObject({ stock: 11 });
  });

  it("cancelling an unpaid order releases its reservation, but only after confirming no payment went through", async () => {
    await setStock(10, 1);
    const o = await makeOrder({ status: "pending_payment", paymentStatus: "pending", reservationExpiresAt: new Date(Date.now() + 600_000) });
    const r = await status(o.orderNumber, { status: "Cancelled" });
    expect(r.status).toBe(200);
    expect(r.body.data.order.status).toBe("Cancelled");
    expect(await variant()).toMatchObject({ stock: 10, reserved: 0 });
    expect((await models.InventoryMovement.find({ order: o._id }).lean()).map((m) => m.type)).toEqual(["release"]);

    // With a payment attempt and no way to ask Razorpay, nothing is released.
    await setStock(10, 1);
    const withAttempt = await makeOrder({ status: "pending_payment", paymentStatus: "pending", paymentAttemptCount: 1 });
    await models.Payment.create({ order: withAttempt._id, orderNumber: withAttempt.orderNumber, attempt: 1, mode: "test", razorpayOrderId: "order_TestAttempt01", amountPaise: 129900, status: "created" });
    const blocked = await status(withAttempt.orderNumber, { status: "Cancelled" });
    expect(blocked.status).toBe(409);
    expect((await Order.findById(withAttempt._id).lean())!.status).toBe("pending_payment");
    expect(await variant()).toMatchObject({ reserved: 1 });
  });

  it("two conflicting updates at once: exactly one cancellation, stock stays consistent", async () => {
    const o = await makeOrder();
    const results = await Promise.all([status(o.orderNumber, { status: "Cancelled" }), status(o.orderNumber, { status: "Confirmed" }), status(o.orderNumber, { status: "Cancelled" })]);
    const doc = await Order.findById(o._id).lean();
    expect(results.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.status === 200 || r.status === 409)).toBe(true);
    const returns = await models.InventoryMovement.countDocuments({ order: o._id, type: "return" });
    expect(returns).toBe(doc!.status === "cancelled" ? 1 : 0);
    expect((await variant()).stock).toBe(10 + returns);
  });

  it("notes and bulk updates", async () => {
    const a = await makeOrder();
    const b = await makeOrder({ status: "pending_payment", paymentStatus: "pending" });
    const note = await call(noteRoute(req(`/api/v1/admin/orders/${a.orderNumber}/notes`, { method: "POST", body: { text: "Gift wrap please" } }), p({ id: a.orderNumber })));
    expect(note.body.data.order.notes[0]).toMatchObject({ text: "Gift wrap please", author: "owner admin" });
    expect((await call(noteRoute(req(`/api/v1/admin/orders/${a.orderNumber}/notes`, { method: "POST", body: { text: "  " } }), p({ id: a.orderNumber })))).status).toBe(400);
    expect(await AuditLog.countDocuments({ action: "order.note" })).toBe(1);

    const bulk = await call(bulkRoute(req("/api/v1/admin/orders/bulk-status", { method: "POST", body: { ids: [a.orderNumber, b.orderNumber, "MMNOTHERE1"], status: "Confirmed" } }), p()));
    expect(bulk.status).toBe(200);
    expect(bulk.body.data.updated).toEqual([a.orderNumber]);
    expect(bulk.body.data.skipped.map((s: { id: string }) => s.id).sort()).toEqual([b.orderNumber, "MMNOTHERE1"].sort());
    expect((await call(bulkRoute(req("/api/v1/admin/orders/bulk-status", { method: "POST", body: { ids: [a.orderNumber], status: "Cancelled" } }), p()))).status).toBe(400);
  });
});

/* ---------- Module 3: Payments & refunds (fake Razorpay — no real money) ---------- */

describe("admin payments", () => {
  const KEY_ID = "rzp_test_FakeKey1234";
  const KEY_SECRET = "fake-key-secret-for-tests";
  const WEBHOOK_SECRET = "fake-webhook-secret-for-tests";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Rec = Record<string, any>;
  const rz = {
    payments: new Map<string, Rec>(),
    refunds: [] as Rec[],
    calls: [] as string[],
    loseNextRefundResponse: false,
    refundStatus: "processed" as "processed" | "pending",
  };

  function fakeRazorpay(url: string, init: RequestInit = {}): Response {
    const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
    if (new Headers(init.headers).get("authorization") !== `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`) return json({ error: { description: "auth" } }, 401);
    const path = url.replace("https://api.razorpay.com/v1", "");
    const method = init.method ?? "GET";
    rz.calls.push(`${method} ${path.split("?")[0]}`);
    let m: RegExpMatchArray | null;
    if (method === "GET" && (m = path.match(/^\/payments\/([^/?]+)$/))) {
      const pay = rz.payments.get(m[1]);
      if (!pay) return json({ error: { description: "not found" } }, 400);
      const refunded = rz.refunds.filter((r) => r.payment_id === pay.id && r.status !== "failed").reduce((s, r) => s + r.amount, 0);
      return json({ ...pay, amount_refunded: refunded, status: refunded >= pay.amount ? "refunded" : pay.status });
    }
    if (method === "POST" && (m = path.match(/^\/payments\/([^/]+)\/refund$/))) {
      const body = JSON.parse(String(init.body));
      const pay = rz.payments.get(m[1])!;
      const refunded = rz.refunds.filter((r) => r.payment_id === pay.id && r.status !== "failed").reduce((s, r) => s + r.amount, 0);
      if (body.amount > pay.amount - refunded) return json({ error: { description: "The refund amount is greater than the refundable amount" } }, 400);
      const refund = { id: `rfnd_${Math.random().toString(36).slice(2, 12)}`, entity: "refund", amount: body.amount, currency: "INR", payment_id: pay.id, status: rz.refundStatus, notes: body.notes };
      rz.refunds.push(refund);
      if (rz.loseNextRefundResponse) {
        rz.loseNextRefundResponse = false;
        throw new TypeError("fetch failed"); // Razorpay created it, but the response never arrived
      }
      return json(refund);
    }
    if (method === "GET" && (m = path.match(/^\/payments\/([^/]+)\/refunds\/([^/]+)$/))) {
      const r = rz.refunds.find((x) => x.id === m![2]);
      return r ? json(r) : json({ error: { description: "not found" } }, 400);
    }
    if (method === "GET" && (m = path.match(/^\/payments\/([^/]+)\/refunds/))) return json({ items: rz.refunds.filter((r) => r.payment_id === m![1]) });
    return json({ error: { description: "unhandled" } }, 404);
  }

  let order: Awaited<ReturnType<typeof makeOrder>>;
  let paymentId: string;
  const RZP_PAY = "pay_TestCaptured01";

  beforeEach(async () => {
    await Promise.all([models.Payment.deleteMany({}), models.WebhookEvent.deleteMany({})]);
    rz.payments.clear();
    rz.refunds = [];
    rz.calls = [];
    rz.loseNextRefundResponse = false;
    rz.refundStatus = "processed";
    vi.stubEnv("RAZORPAY_KEY_ID", KEY_ID);
    vi.stubEnv("RAZORPAY_KEY_SECRET", KEY_SECRET);
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", WEBHOOK_SECRET);
    resetEnvCache();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => fakeRazorpay(String(input), init)));

    const c = await makeCustomer({ fullName: "Refund Customer", email: "refund.customer@example.com" });
    order = await makeOrder({ user: c._id, customer: { fullName: "Refund Customer", email: "refund.customer@example.com", mobile: "9876500000" }, totalPaise: 200000, razorpayPaymentId: RZP_PAY, paymentMode: "test" });
    await models.Payment.create({
      order: order._id, orderNumber: order.orderNumber, user: c._id, attempt: 1, mode: "test", razorpayOrderId: "order_TestFailed01", amountPaise: 200000, status: "failed",
      failures: [{ razorpayPaymentId: "pay_TestFailed01", code: "BAD_REQUEST_ERROR", description: "Payment declined by bank", source: "webhook" }], errorDescription: "Payment declined by bank",
    });
    paymentId = (
      await models.Payment.create({
        order: order._id, orderNumber: order.orderNumber, user: c._id, attempt: 2, mode: "test", razorpayOrderId: "order_TestCaptured1", razorpayPaymentId: RZP_PAY, amountPaise: 200000,
        status: "captured", method: "upi", methodDetail: "", feePaise: 4720, taxPaise: 850, capturedAt: new Date(), verifiedBy: "verify",
      })
    ).id;
    rz.payments.set(RZP_PAY, { id: RZP_PAY, order_id: "order_TestCaptured1", amount: 200000, currency: "INR", status: "captured", method: "upi" });
    await models.WebhookEvent.create({ provider: "razorpay", eventId: "evt_seen_1", type: "payment.captured", status: "processed", payloadHash: "x", razorpayOrderId: "order_TestCaptured1", razorpayPaymentId: RZP_PAY });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  const refund = (body: Record<string, unknown>, as: As = "owner") => call(refundRoute(req(`/api/v1/admin/payments/${paymentId}/refunds`, { method: "POST", body, as }), p({ id: paymentId })));
  const key = () => `refund-key-${Math.random().toString(36).slice(2)}-abcdefgh`;
  const stored = async () => (await models.Payment.findById(paymentId).lean())!;
  const storedOrder = async () => (await Order.findById(order._id).lean())!;

  it("enforces permissions: staff can't see payments; only payments:refund can refund", async () => {
    expect((await call(listPaymentsRoute(req("/api/v1/admin/payments", { as: "staff" }), p()))).status).toBe(403);
    expect((await call(listPaymentsRoute(req("/api/v1/admin/payments", { as: "manager" }), p()))).status).toBe(200);
    expect((await refund({ reason: "Out of stock", idempotencyKey: key() }, "staff")).status).toBe(403);
    expect((await call(listPaymentsRoute(req("/api/v1/admin/payments", { as: "none" }), p()))).status).toBe(401);
  });

  it("lists accurate payment records with search, tabs and figures", async () => {
    const list = async (qs = "") => (await call(listPaymentsRoute(req(`/api/v1/admin/payments?${qs}`), p()))).body.data;
    const all = await list();
    expect(all.total).toBe(2);
    expect(all.summary).toMatchObject({ successful: 1, failed: 1, collected: 2000, refunded: 0, counts: { all: 2, paid: 1, failed: 1, refunded: 0 } });
    const captured = all.items.find((x: { status: string }) => x.status === "captured");
    expect(captured).toMatchObject({ razorpayPaymentId: RZP_PAY, orderId: order.orderNumber, customerName: "Refund Customer", amount: 2000, fee: 55.7, attempt: 2, mode: "test", verifiedBy: "verify" });
    expect((await list("group=failed")).items[0]).toMatchObject({ status: "failed", errorReason: "Payment declined by bank" });
    expect((await list(`q=${order.orderNumber}`)).total).toBe(2);
    expect((await list("q=pay_TestCapt")).total).toBe(1);
    expect((await list("q=refund.customer")).total).toBe(2);
    expect((await list("q=nobody")).total).toBe(0);
    expect((await call(listPaymentsRoute(req("/api/v1/admin/payments?group=everything"), p()))).status).toBe(400);
  });

  it("shows attempts, failures and webhook history in the detail", async () => {
    const d = (await call(getPaymentRoute(req(`/api/v1/admin/payments/${paymentId}`), p({ id: paymentId })))).body.data;
    expect(d.payment).toMatchObject({ status: "captured", attempt: 2 });
    expect(d.order).toMatchObject({ id: order.orderNumber, paymentStatus: "captured" });
    expect(d.webhooks).toEqual([expect.objectContaining({ type: "payment.captured", status: "processed" })]);
    expect(d.refundable).toBe(2000);
    const raw = JSON.stringify(d);
    for (const secret of [KEY_SECRET, WEBHOOK_SECRET, "payloadHash"]) expect(raw).not.toContain(secret);
  });

  it("refunds part, then the rest, through Razorpay — recorded only from Razorpay's answers", async () => {
    const part = await refund({ amountPaise: 50000, reason: "One item damaged", idempotencyKey: key() });
    expect(part.status).toBe(200);
    expect(part.body.data.refunds).toEqual([expect.objectContaining({ amount: 500, status: "processed", reason: "One item damaged", by: "owner admin" })]);
    expect(await stored()).toMatchObject({ status: "partially_refunded", refundedPaise: 50000 });
    expect(await storedOrder()).toMatchObject({ paymentStatus: "partially_refunded", refundedPaise: 50000 });
    expect(rz.calls.filter((c) => c.endsWith("/refund"))).toHaveLength(1);

    expect((await refund({ amountPaise: 160000, reason: "Too much", idempotencyKey: key() })).status).toBe(400);
    const rest = await refund({ reason: "Order cancelled", idempotencyKey: key() });
    expect(rest.body.data.refunds.map((r: { amount: number }) => r.amount)).toEqual([500, 1500]);
    expect(await storedOrder()).toMatchObject({ paymentStatus: "refunded", refundedPaise: 200000 });
    expect(rest.body.data.refundable).toBe(0);
    expect((await refund({ reason: "Again", idempotencyKey: key() })).status).toBe(409);
    expect(await AuditLog.countDocuments({ action: "payment.refund" })).toBe(2);

    for (const bad of [{ reason: "x", idempotencyKey: key() }, { amountPaise: 50, reason: "Too small", idempotencyKey: key() }, { amountPaise: 1.5, reason: "Fraction", idempotencyKey: key() }, { reason: "No key" }]) {
      expect((await refund(bad)).status).toBe(400);
    }
  });

  it("never refunds twice: repeated keys, simultaneous requests and lost responses", async () => {
    const k = key();
    const first = await refund({ amountPaise: 30000, reason: "Partial", idempotencyKey: k });
    const again = await refund({ amountPaise: 30000, reason: "Partial", idempotencyKey: k });
    expect([first.status, again.status]).toEqual([200, 200]);
    expect(again.body.message).toMatch(/already/);
    expect(rz.refunds).toHaveLength(1);

    const results = await Promise.all([refund({ amountPaise: 10000, reason: "Item A", idempotencyKey: key() }), refund({ amountPaise: 10000, reason: "Item B", idempotencyKey: key() })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(rz.refunds).toHaveLength(2);

    rz.loseNextRefundResponse = true;
    const lost = await refund({ amountPaise: 20000, reason: "Network blip", idempotencyKey: key() });
    expect(lost.status).toBe(200); // found by its idempotency key instead of failing or retrying blindly
    expect(rz.refunds).toHaveLength(3);
    expect((await stored()).refunds).toHaveLength(3);
    expect(await storedOrder()).toMatchObject({ refundedPaise: 60000, paymentStatus: "partially_refunded" });
  });

  it("refuses refunds for payments that weren't captured", async () => {
    const failed = await models.Payment.findOne({ status: "failed" }).lean();
    const r = await call(refundRoute(req(`/api/v1/admin/payments/${failed!._id}/refunds`, { method: "POST", body: { reason: "Nope", idempotencyKey: key() } }), p({ id: String(failed!._id) })));
    expect(r.status).toBe(409);
    expect(rz.calls).toHaveLength(0);
  });

  it("pending refunds are completed by a verified webhook or a status sync — never by the admin's say-so", async () => {
    rz.refundStatus = "pending";
    const created = await refund({ amountPaise: 40000, reason: "Pending one", idempotencyKey: key() });
    const refundId = created.body.data.refunds[0].razorpayRefundId as string;
    expect(created.body.data.refunds[0].status).toBe("pending");

    // A forged webhook changes nothing.
    const { createHmac } = await import("node:crypto");
    const send = (raw: string, secret = WEBHOOK_SECRET, id = `evt_${Math.random().toString(36).slice(2)}`) =>
      webhookRoute(
        new NextRequest(`${ORIGIN}/api/v1/payments/razorpay/webhook`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-razorpay-signature": createHmac("sha256", secret).update(raw).digest("hex"), "x-razorpay-event-id": id },
          body: raw,
        }),
        p(),
      );
    const event = (status: string) => JSON.stringify({ event: `refund.${status}`, payload: { refund: { entity: { ...rz.refunds[0], status } } } });
    expect((await send(event("processed"), "wrong-secret")).status).toBe(400);
    expect((await stored()).refunds[0].status).toBe("pending");

    rz.refunds[0].status = "processed";
    const ok = await send(event("processed"));
    expect(ok.status).toBe(200);
    expect((await stored()).refunds[0].status).toBe("processed");

    // A refund that later fails no longer counts.
    rz.refunds[0].status = "failed";
    const synced = await call(syncRefundRoute(req(`/api/v1/admin/payments/${paymentId}/refunds/${refundId}`, { method: "POST", body: {} }), p({ id: paymentId, refundId })));
    expect(synced.body.data.refunds[0].status).toBe("failed");
    expect(await storedOrder()).toMatchObject({ refundedPaise: 0, paymentStatus: "captured" });
    expect(await AuditLog.countDocuments({ action: "payment.refund_sync" })).toBe(1);
  });
});

/* ---------- Module 4: Coupons & offers ---------- */

describe("admin coupons", () => {
  const body = (over: Record<string, unknown> = {}) => ({
    code: "DIWALI15",
    type: "percent",
    value: 15,
    minOrderPaise: 199900,
    maxDiscountPaise: 50000,
    startsAt: new Date(Date.now() - 86_400_000).toISOString(),
    ...over,
  });
  const create = (b: Record<string, unknown>, as: As = "owner") => call(createCouponRoute(req("/api/v1/admin/coupons", { method: "POST", body: b, as }), p()));
  const patch = (id: string, b: Record<string, unknown>, as: As = "owner") => call(patchCouponRoute(req(`/api/v1/admin/coupons/${id}`, { method: "PATCH", body: b, as }), p({ id })));
  const del = (id: string) => call(deleteCouponRoute(req(`/api/v1/admin/coupons/${id}`, { method: "DELETE" }), p({ id })));

  beforeEach(async () => {
    await Promise.all([models.Coupon.deleteMany({}), models.CouponRedemption.deleteMany({}), models.Offer.deleteMany({})]);
  });

  it("enforces permissions", async () => {
    expect((await call(listCouponsRoute(req("/api/v1/admin/coupons", { as: "staff" }), p()))).status).toBe(403);
    expect((await call(listCouponsRoute(req("/api/v1/admin/coupons", { as: "manager" }), p()))).status).toBe(200);
    expect((await create(body(), "staff")).status).toBe(403);
    expect((await create(body(), "manager")).status).toBe(201);
    expect((await create(body({ code: "NOAUTH" }), "none")).status).toBe(401);
  });

  it("creates coupons in paise, shows rupees, and validates every rule", async () => {
    const pct = await create(body());
    expect(pct.status).toBe(201);
    expect(pct.body.data).toMatchObject({ code: "DIWALI15", type: "percent", value: 15, minOrder: 1999, maxDiscount: 500, active: true, usageCount: 0 });
    const flat = await create(body({ code: "flat100", type: "flat", value: 10000, maxDiscountPaise: null, minOrderPaise: 79900 }));
    expect(flat.body.data).toMatchObject({ code: "FLAT100", value: 100, minOrder: 799 });
    expect((await models.Coupon.findOne({ code: "FLAT100" }).lean())!.value).toBe(10000);

    expect((await create(body())).status).toBe(409); // unique code
    const bad: Record<string, unknown>[] = [
      { code: "no spaces" },
      { code: "AB" },
      { value: 95 },
      { value: 12.5 },
      { type: "flat", value: 50, maxDiscountPaise: null },
      { type: "flat", value: 10000, maxDiscountPaise: 5000 },
      { minOrderPaise: 99.5 },
      { endsAt: new Date(Date.now() - 2 * 86_400_000).toISOString() },
      { usageLimit: 0 },
      { perCustomerLimit: -1 },
      { products: ["p-does-not-exist"] },
      { categories: ["kurtis"], excludedCategories: ["kurtis"] },
    ];
    for (const over of bad) expect((await create(body({ code: `BAD${Math.random().toString(36).slice(2, 7).toUpperCase()}`, ...over }))).status, JSON.stringify(over)).toBe(400);
    expect(await AuditLog.countDocuments({ action: "coupon.create" })).toBe(2);
  });

  it("partial updates change only what was sent (restrictions survive a toggle) and usage can't be rewritten", async () => {
    const c = (await create(body({ categories: ["kurtis"], perCustomerLimit: 2, usageLimit: 10 }))).body.data;
    await models.Coupon.updateOne({ _id: c.id }, { $set: { usageCount: 4 } });
    const off = await patch(c.id, { active: false });
    expect(off.body.data).toMatchObject({ active: false, categories: ["kurtis"], perCustomerLimit: 2, usageLimit: 10, usageCount: 4 });
    expect(await AuditLog.countDocuments({ action: "coupon.disable" })).toBe(1);

    expect((await patch(c.id, { usageCount: 0 })).body.data.usageCount).toBe(4); // unknown field ignored
    expect((await patch(c.id, { usageLimit: 3 })).status).toBe(400); // below uses so far
    expect((await patch(c.id, { code: "RENAMED" })).status).toBe(409); // already used
    expect((await patch(c.id, { endsAt: new Date(Date.now() - 5 * 86_400_000).toISOString() })).status).toBe(400); // before start
    const edited = await patch(c.id, { value: 20, description: "Festive 20%" });
    expect(edited.body.data).toMatchObject({ value: 20, description: "Festive 20%", categories: ["kurtis"] });
  });

  it("deletes only coupons that were never used; used ones must be disabled", async () => {
    const unused = (await create(body({ code: "UNUSED1" }))).body.data;
    expect((await del(unused.id)).status).toBe(200);
    expect(await models.Coupon.countDocuments({ code: "UNUSED1" })).toBe(0);

    const used = (await create(body({ code: "USEDONE" }))).body.data;
    const o = await makeOrder({ coupon: { coupon: used.id, code: "USEDONE", discountPaise: 1000 } });
    await models.CouponRedemption.create({ coupon: used.id, code: "USEDONE", order: o._id, email: "guest@example.com", discountPaise: 1000, status: "redeemed" });
    const r = await del(used.id);
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/Disable it instead/);
    expect(await models.Coupon.countDocuments({ code: "USEDONE" })).toBe(1);
    expect(await AuditLog.countDocuments({ action: "coupon.delete" })).toBe(1);

    const usage = await call(couponUsageRoute(req(`/api/v1/admin/coupons/${used.id}/usage`), p({ id: used.id })));
    expect(usage.body.data.items).toEqual([expect.objectContaining({ orderId: o.orderNumber, discount: 10, status: "redeemed" })]);
  });

  it("lists with search, status filter and pagination", async () => {
    await create(body({ code: "LIVEONE" }));
    await create(body({ code: "LATER", startsAt: new Date(Date.now() + 86_400_000).toISOString() }));
    await create(body({ code: "OFFNOW", active: false }));
    const usedUp = (await create(body({ code: "GONE", usageLimit: 1 }))).body.data;
    await models.Coupon.updateOne({ _id: usedUp.id }, { $set: { usageCount: 1 } });
    const list = async (qs: string) => (await call(listCouponsRoute(req(`/api/v1/admin/coupons?${qs}`), p()))).body.data;
    expect((await list("state=live")).items.map((c: { code: string }) => c.code)).toEqual(["LIVEONE"]);
    expect((await list("state=scheduled")).items[0].code).toBe("LATER");
    expect((await list("state=disabled")).items[0].code).toBe("OFFNOW");
    expect((await list("state=used_up")).items[0].code).toBe("GONE");
    expect((await list("q=liv")).total).toBe(1);
    expect((await list("limit=2&page=2")).items).toHaveLength(2);
    expect((await list("")).summary).toMatchObject({ all: 4, live: 1, redemptions: 1 });
  });

  it("checkout honours exclusions and restrictions set here", async () => {
    const { evaluateCoupon } = await import("./coupon.service");
    const other = await Category.create({ slug: "dresses", audience: "women", name: "Dresses" });
    await create(body({ code: "NOKURTI", minOrderPaise: 0, maxDiscountPaise: null, value: 10, excludedCategories: ["kurtis"] }));
    const kurtiLine = { product: productId, categories: [categoryId], lineTotalPaise: 100000 };
    const dressLine = { product: new Types.ObjectId(), categories: [other._id], lineTotalPaise: 50000 };
    expect(await evaluateCoupon("NOKURTI", [kurtiLine], {})).toMatchObject({ ok: false });
    expect(await evaluateCoupon("NOKURTI", [kurtiLine, dressLine], {})).toMatchObject({ ok: true, discountPaise: 5000 });
    await Category.deleteOne({ _id: other._id });
  });

  it("manages announcement-bar offers", async () => {
    const created = await call(createOfferRoute(req("/api/v1/admin/offers", { method: "POST", body: { title: "Festive sale", subtitle: "Up to 30% off", code: "fest30", href: "/shop" } }), p()));
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ title: "Festive sale", code: "FEST30", active: true });
    const id = created.body.data.id;
    for (const href of ["javascript:alert(1)", "//evil.example", "http://insecure.example"]) {
      expect((await call(patchOfferRoute(req(`/api/v1/admin/offers/${id}`, { method: "PATCH", body: { href } }), p({ id })))).status).toBe(400);
    }
    const toggled = await call(patchOfferRoute(req(`/api/v1/admin/offers/${id}`, { method: "PATCH", body: { active: false } }), p({ id })));
    expect(toggled.body.data).toMatchObject({ active: false, title: "Festive sale", code: "FEST30" });
    expect((await call(listOffersRoute(req("/api/v1/admin/offers", { as: "staff" }), p()))).status).toBe(403);
    expect((await call(deleteOfferRoute(req(`/api/v1/admin/offers/${id}`, { method: "DELETE" }), p({ id })))).status).toBe(200);
    expect(await AuditLog.countDocuments({ action: { $in: ["offer.create", "offer.update", "offer.delete"] } })).toBe(3);
  });
});

/* ---------- Module 5: Homepage banners (Cloudinary stubbed) ---------- */

describe("admin homepage banners", () => {
  const destroyed: string[] = [];
  let n = 0;
  async function uploaded() {
    n += 1;
    const publicId = `mm-collections/banners/test-${n}`;
    const url = `https://res.cloudinary.com/testcloud/image/upload/v1/${publicId}.webp`;
    await models.MediaAsset.create({ publicId, purpose: "banner", status: "uploaded", url, format: "webp", bytes: 200_000, width: 1600, height: 2000 });
    return { url, publicId };
  }
  const banner = async (over: Record<string, unknown> = {}) => ({ placement: "hero", title: "Silk sarees", subtitle: "Zari borders", ctaLabel: "Shop", ctaHref: "/shop", image: await uploaded(), ...over });
  const create = (b: Record<string, unknown>, as: As = "owner") => call(createBannerRoute(req("/api/v1/admin/banners", { method: "POST", body: b, as }), p()));
  const patch = (id: string, b: Record<string, unknown>) => call(patchBannerRoute(req(`/api/v1/admin/banners/${id}`, { method: "PATCH", body: b }), p({ id })));

  beforeEach(async () => {
    await Promise.all([models.HomepageBanner.deleteMany({}), models.MediaAsset.deleteMany({}), models.StoreSettings.deleteMany({})]);
    destroyed.length = 0;
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "testcloud");
    vi.stubEnv("CLOUDINARY_API_KEY", "123456789012345");
    vi.stubEnv("CLOUDINARY_API_SECRET", "test-cloudinary-secret");
    resetEnvCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/image/destroy")) {
          destroyed.push(new URLSearchParams(String(init?.body)).get("public_id") ?? "");
          return Response.json({ result: "ok" });
        }
        return new Response("{}", { status: 404 });
      }),
    );
  });

  afterAll(() => vi.unstubAllGlobals());

  it("enforces permissions", async () => {
    expect((await call(getHomepageRoute(req("/api/v1/admin/homepage", { as: "staff" }), p()))).status).toBe(403);
    expect((await call(getHomepageRoute(req("/api/v1/admin/homepage", { as: "manager" }), p()))).status).toBe(200);
    expect((await create(await banner(), "staff")).status).toBe(403);
    expect((await create(await banner(), "none")).status).toBe(401);
  });

  it("accepts only images uploaded through the admin flow, and validates fields", async () => {
    const input = await banner();
    const ok = await create(input);
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ placement: "hero", title: "Silk sarees", active: true, imagePublicId: input.image.publicId });
    expect((await models.MediaAsset.findOne({ publicId: input.image.publicId }).lean())!.status).toBe("attached");

    const external = await create(await banner({ image: { url: "https://evil.example/x.jpg" } }));
    expect(external.status).toBe(400);
    const mismatched = await create(await banner({ image: { url: "https://res.cloudinary.com/testcloud/image/upload/v1/other.webp", publicId: (await uploaded()).publicId } }));
    expect(mismatched.status).toBe(400);
    for (const over of [{ title: "" }, { ctaHref: "javascript:alert(1)" }, { ctaHref: "//evil.example" }, { placement: "sidebar" }, { image: { url: "http://insecure.example/x.jpg" } }, { startsAt: "2026-12-10", endsAt: "2026-12-01" }]) {
      expect((await create(await banner(over))).status, JSON.stringify(over)).toBe(400);
    }
    expect(await AuditLog.countDocuments({ action: "banner.create" })).toBe(1);
  });

  it("replacing or deleting an image removes the old one from Cloudinary; toggles change only what was sent", async () => {
    const b = (await create(await banner())).body.data;
    const toggled = await patch(b.id, { active: false });
    expect(toggled.body.data).toMatchObject({ active: false, title: "Silk sarees", imagePublicId: b.imagePublicId });
    expect(destroyed).toEqual([]);
    expect(await AuditLog.countDocuments({ action: "banner.deactivate" })).toBe(1);

    const next = await uploaded();
    const replaced = await patch(b.id, { image: next });
    expect(replaced.body.data.imagePublicId).toBe(next.publicId);
    expect(destroyed).toEqual([b.imagePublicId]);
    expect((await models.MediaAsset.findOne({ publicId: b.imagePublicId }).lean())!.status).toBe("deleted");

    // Keeping the current image (no publicId sent) is fine.
    expect((await patch(b.id, { image: { url: next.url }, title: "Renamed" })).body.data.title).toBe("Renamed");

    expect((await call(deleteBannerRoute(req(`/api/v1/admin/banners/${b.id}`, { method: "DELETE" }), p({ id: b.id })))).status).toBe(200);
    expect(destroyed).toEqual([b.imagePublicId, next.publicId]);
    expect(await models.HomepageBanner.countDocuments()).toBe(0);
  });

  it("reorders banners within a placement", async () => {
    const a = (await create(await banner({ title: "A" }))).body.data;
    const b = (await create(await banner({ title: "B" }))).body.data;
    await create(await banner({ title: "Promo", placement: "promo" }));
    const moved = await call(moveBannerRoute(req(`/api/v1/admin/banners/${b.id}/move`, { method: "POST", body: { direction: -1 } }), p({ id: b.id })));
    const heroes = moved.body.data.banners.filter((x: { placement: string }) => x.placement === "hero").map((x: { title: string }) => x.title);
    expect(heroes).toEqual(["B", "A"]);
    expect((await call(moveBannerRoute(req(`/api/v1/admin/banners/${a.id}/move`, { method: "POST", body: { direction: 2 } }), p({ id: a.id })))).status).toBe(400);
  });

  it("the storefront shows only active banners inside their dates, first by display order", async () => {
    const { loadStorefrontBanners } = await import("./homepage.service");
    const day = 86_400_000;
    await create(await banner({ title: "Off", active: false }));
    await create(await banner({ title: "Later", startsAt: new Date(Date.now() + day).toISOString() }));
    await create(await banner({ title: "Ended", startsAt: new Date(Date.now() - 3 * day).toISOString(), endsAt: new Date(Date.now() - day).toISOString() }));
    await create(await banner({ title: "Live hero" }));
    await create(await banner({ title: "Second live hero" }));
    await create(await banner({ title: "Live promo", placement: "promo", eyebrow: "Sale" }));
    const shown = await loadStorefrontBanners();
    expect(shown.hero).toMatchObject({ title: "Live hero", ctaHref: "/shop" });
    expect(shown.promo).toMatchObject({ title: "Live promo", eyebrow: "Sale" });
    expect(shown.hero!.image).toMatch(/^https:\/\/res\.cloudinary\.com\//);

    await models.HomepageBanner.updateMany({}, { $set: { active: false } });
    expect(await loadStorefrontBanners()).toEqual({ hero: null, promo: null }); // built-in design is used
  });

  it("sets featured products (active ones, in order) and section visibility", async () => {
    const draft = await Product.create({
      slug: "draft-dress", name: "Draft Dress", sku: "MM-DD", audience: "women", category: categoryId, status: "draft", pricePaise: 0, mrpPaise: 0,
      variants: [{ sku: "MM-DD-M", size: "M", pricePaise: 99900, mrpPaise: 99900, stock: 1 }],
    });
    const put = (productIds: string[]) => call(featuredRoute(req("/api/v1/admin/homepage/featured", { method: "PUT", body: { productIds } }), p()));
    const ok = await put([String(productId)]);
    expect(ok.status).toBe(200);
    expect(ok.body.data.featuredProductIds).toEqual([String(productId)]);
    expect((await put([String(draft._id)])).status).toBe(400);
    expect((await put(["nope"])).status).toBe(400);
    expect((await put(Array.from({ length: 9 }, (_, i) => `p${i}`))).status).toBe(400);
    expect((await put([String(productId), String(productId)])).status).toBe(400);

    const hidden = await call(sectionsRoute(req("/api/v1/admin/homepage/sections", { method: "PATCH", body: { key: "testimonials", visible: false } }), p()));
    expect(hidden.body.data.sections.find((s: { id: string }) => s.id === "testimonials").visible).toBe(false);
    expect(hidden.body.data.sections).toHaveLength(7);
    expect((await call(sectionsRoute(req("/api/v1/admin/homepage/sections", { method: "PATCH", body: { key: "hero", visible: false } }), p()))).status).toBe(400);
    expect(await AuditLog.countDocuments({ action: { $in: ["homepage.featured", "homepage.section"] } })).toBe(2);
    await Product.deleteOne({ _id: draft._id });
  });
});

/* ---------- Module 6: Store settings ---------- */

describe("admin store settings", () => {
  const get = (as: As = "owner") => call(getSettingsRoute(req("/api/v1/admin/settings", { as }), p()));
  const patchSettings = (body: Record<string, unknown>, as: As = "owner") => call(patchSettingsRoute(req("/api/v1/admin/settings", { method: "PATCH", body, as }), p()));
  const patchShipping = (body: Record<string, unknown>, as: As = "owner") => call(patchShippingRoute(req("/api/v1/admin/settings/shipping", { method: "PATCH", body, as }), p()));
  const couriers = [
    { id: "delhivery", name: "Delhivery", trackingUrlTemplate: "https://www.delhivery.com/track/package/{awb}", enabled: true },
    { id: "bluedart", name: "Blue Dart", trackingUrlTemplate: "", enabled: false },
  ];

  beforeEach(async () => {
    await Promise.all([models.StoreSettings.deleteMany({}), models.MediaAsset.deleteMany({})]);
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_FakeKey1234");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "super-secret-value-never-shown");
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "");
    resetEnvCache();
  });

  it("enforces permissions: staff can't see settings, managers can read and edit shipping but not store settings", async () => {
    expect((await get("staff")).status).toBe(403);
    expect((await get("none")).status).toBe(401);
    expect((await get("manager")).status).toBe(200);
    expect((await patchSettings({ store: { storeName: "Hijack" } }, "manager")).status).toBe(403);
    expect((await patchShipping({ deliveryEstimate: "3–7 days", dispatchTime: "1–2 days", couriers }, "manager")).status).toBe(200);
    expect((await patchShipping({ deliveryEstimate: "3–7 days", dispatchTime: "1–2 days", couriers }, "staff")).status).toBe(403);
    const crossSite = await call(patchSettingsRoute(req("/api/v1/admin/settings", { method: "PATCH", body: { store: { storeName: "X Store" } }, origin: "https://evil.example" }), p()));
    expect(crossSite.status).toBe(403);
  });

  it("shows fixed rules and payment status without exposing secrets", async () => {
    const r = await get();
    expect(r.body.data.locked).toEqual({ currency: "INR", country: "India", codEnabled: false, shippingNotice: "Shipping Charges Applicable" });
    expect(r.body.data.payments).toEqual({ configured: true, mode: "test", keyIdMasked: "rzp_test_••••34", webhookConfigured: false });
    expect(r.body.data.shipping.chargesNotice).toBe("Shipping Charges Applicable");
    const raw = JSON.stringify(r.body);
    for (const secret of ["super-secret-value-never-shown", "rzp_test_FakeKey1234", "MONGODB", "JWT_"]) expect(raw).not.toContain(secret);
  });

  it("validates every field strictly", async () => {
    const bad: Record<string, unknown>[] = [
      { store: { storeName: "" } },
      { store: { email: "not-an-email" } },
      { store: { phone: "12345" } },
      { store: { gstin: "NOTAGSTIN" } },
      { store: { logo: "https://evil.example/logo.png" } },
      { social: { instagram: "https://evil.example/mm" } },
      { social: { facebook: "http://facebook.com/mm" } },
      { policies: { returnWindowDays: 61 } },
      { policies: { privacyContact: "nope" } },
      { seo: { title: "x".repeat(71) } },
      {},
    ];
    for (const body of bad) expect((await patchSettings(body)).status, JSON.stringify(body)).toBe(400);
  });

  it("saves only what changed, audits field names, accepts uploaded logos, and refuses stale edits", async () => {
    const before = (await get()).body.data;
    await models.MediaAsset.create({ publicId: "mm-collections/brand/logo-1", purpose: "logo", status: "uploaded", url: "https://res.cloudinary.com/testcloud/image/upload/v1/mm-collections/brand/logo-1.png" });
    const saved = await patchSettings({
      version: before.version,
      store: { storeName: "M&M COLLECTIONS", email: "hello@mmcollections.in", phone: "+91 98765 43210", gstin: "32ABCDE1234F1Z5", logo: "https://res.cloudinary.com/testcloud/image/upload/v1/mm-collections/brand/logo-1.png" },
      social: { instagram: "https://www.instagram.com/mmcollections" },
      seo: { title: "M&M COLLECTIONS — Women's Fashion", description: "Kurtis, sarees and more." },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.data.settings).toMatchObject({ email: "hello@mmcollections.in", gstin: "32ABCDE1234F1Z5", social: { instagram: "https://www.instagram.com/mmcollections" }, seo: { title: "M&M COLLECTIONS — Women's Fashion" } });
    const log = await AuditLog.findOne({ action: "settings.update" }).lean();
    expect((log!.changes as { fields: string[] }).fields).toEqual(expect.arrayContaining(["store.email", "store.logo", "social.instagram", "seo.title"]));
    expect(JSON.stringify(log!.changes)).not.toContain("hello@mmcollections.in"); // names only

    const stale = await patchSettings({ version: before.version, store: { tagline: "Old tab" } });
    expect(stale.status).toBe(409);
    const fresh = await patchSettings({ version: saved.body.data.version, store: { tagline: "New tab" } });
    expect(fresh.body.data.settings.tagline).toBe("New tab");

    await patchSettings({ store: { tagline: "New tab" } }); // no change → no audit
    expect(await AuditLog.countDocuments({ action: "settings.update" })).toBe(2);
  });

  it("keeps the fixed business rules no matter what is sent or stored", async () => {
    await get(); // creates the document
    await models.StoreSettings.updateOne({ key: "store" }, { $set: { "shipping.chargesNotice": "Free shipping!", "shipping.country": "USA" } }, { runValidators: false, strict: false });
    expect((await get()).body.data.shipping.chargesNotice).toBe("Shipping Charges Applicable");

    const r = await patchShipping({ deliveryEstimate: "3–7 business days", dispatchTime: "Within 2 days", couriers, chargesNotice: "₹49 flat", country: "UK", codEnabled: true });
    expect(r.status).toBe(200);
    const doc = await models.StoreSettings.findOne({ key: "store" }).lean();
    expect(doc!.shipping).toMatchObject({ chargesNotice: "Shipping Charges Applicable", country: "India" });
    expect(doc!.checkout!.codEnabled).toBe(false);
    expect(r.body.data.shipping.couriers).toEqual(couriers);
    expect(await AuditLog.countDocuments({ action: "settings.shipping" })).toBe(1);

    for (const list of [[{ ...couriers[0], enabled: false }], [{ ...couriers[0], trackingUrlTemplate: "https://track.example/no-placeholder" }], [{ ...couriers[0], trackingUrlTemplate: "http://track.example/{awb}" }], [], [couriers[0], couriers[0]]]) {
      expect((await patchShipping({ deliveryEstimate: "3–7 days", dispatchTime: "1–2 days", couriers: list })).status, JSON.stringify(list)).toBe(400);
    }
  });

  it("couriers saved here are offered when adding tracking to an order", async () => {
    await patchShipping({ deliveryEstimate: "3–7 days", dispatchTime: "1–2 days", couriers });
    const o = await makeOrder();
    const detail = await call(getOrderRoute(req(`/api/v1/admin/orders/${o.orderNumber}`), p({ id: o.orderNumber })));
    expect(detail.body.data.couriers).toEqual([{ name: "Delhivery", trackingUrlTemplate: "https://www.delhivery.com/track/package/{awb}" }]);
  });
});
