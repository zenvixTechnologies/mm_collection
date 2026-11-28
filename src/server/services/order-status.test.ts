import { MongoMemoryReplSet } from "mongodb-memory-server";
import { Types } from "mongoose";
import { NextRequest, type NextResponse } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login } from "@/app/api/v1/admin/auth/login/route";
import { POST as bulkRoute } from "@/app/api/v1/admin/orders/bulk-status/route";
import { POST as noteRoute } from "@/app/api/v1/admin/orders/[id]/notes/route";
import { GET as adminOrderRoute } from "@/app/api/v1/admin/orders/[id]/route";
import { PATCH as statusRoute } from "@/app/api/v1/admin/orders/[id]/status/route";
import { GET as listAdminOrders } from "@/app/api/v1/admin/orders/route";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { GET as orderRoute } from "@/app/api/v1/orders/[id]/route";
import { GET as myOrdersRoute } from "@/app/api/v1/orders/route";
import { ADMIN_NAV } from "@/components/admin/layout/admin-nav";
import { timelineSteps } from "@/lib/shipment";
import { DEFAULT_ROLE_PERMISSIONS } from "@/server/auth/permissions";
import { hashPassword } from "@/server/auth/password";
import { resetEnvCache } from "@/server/config/env";
import { connectToDatabase, disconnectFromDatabase } from "@/server/db/connect";
import * as models from "@/server/models";
import { Admin, AuditLog, Category, Order, Product, Role, User } from "@/server/models";
import { resetRateLimits } from "@/server/security/rate-limit";
import { newAccessNonce, orderAccessToken } from "@/server/services/order.service";

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }));

/**
 * Manual order status updates, end to end through the API routes, against a throwaway in-memory
 * MongoDB. No courier or shipment details are involved. No network: any outgoing request fails.
 */

const ORIGIN = "http://localhost:3000";
const PW = "Correct-horse-42";
type Jar = Record<string, string>;
type As = "owner" | "manager" | "staff";
const jars = {} as Record<As, Jar>;
const adminIds = {} as Record<As, string>;
let rs: MongoMemoryReplSet;
const fetchSpy = vi.fn(async (input: unknown) => {
  throw new Error(`Order status updates must not call out: ${String(input)}`);
});

function req(path: string, init: { method?: string; body?: unknown; jar?: Jar | null; origin?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { origin: init.origin ?? ORIGIN, ...init.headers };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.jar) headers.cookie = Object.entries(init.jar).map(([k, v]) => `${k}=${v}`).join("; ");
  return new NextRequest(`${ORIGIN}${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}
const p = <T extends Record<string, string>>(params: T = {} as T) => ({ params: Promise.resolve(params) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = { success: boolean; message: string; data: any; error?: { code: string } };
const call = async (res: Response | Promise<Response>) => {
  const r = await res;
  return { status: r.status, body: (await r.json()) as Body };
};
const jarOf = (as: As | "none") => (as === "none" ? null : jars[as]);

const setStatus = (id: string, status: string, extra: Record<string, unknown> = {}, as: As | "none" = "owner") =>
  call(statusRoute(req(`/api/v1/admin/orders/${id}/status`, { method: "PATCH", body: { status, ...extra }, jar: jarOf(as) }), p({ id })));
const adminOrder = (id: string, as: As | "none" = "owner") => call(adminOrderRoute(req(`/api/v1/admin/orders/${id}`, { jar: jarOf(as) }), p({ id })));
const customerOrder = (id: string, opts: { jar?: Jar; token?: string } = {}) =>
  call(orderRoute(req(`/api/v1/orders/${id}`, { jar: opts.jar, headers: opts.token ? { "x-order-token": opts.token } : {} }), p({ id })));

let seq = 0;
let productId: Types.ObjectId;
let categoryId: Types.ObjectId;

async function makeOrder(over: Record<string, unknown> = {}) {
  seq += 1;
  return Order.create({
    orderNumber: `MMSTAT${String(seq).padStart(4, "0")}`,
    user: null,
    customer: { fullName: "Guest Buyer", email: "guest@example.com", mobile: "9876543210" },
    shippingAddress: { house: "1 Test House", street: "MG Road", city: "Kochi", district: "Ernakulam", state: "Kerala", pincode: "682001", country: "India" },
    items: [
      { product: productId, variantSku: "MM-K1-M-ROSE", name: "Rose Kurti", slug: "rose-kurti", category: categoryId, size: "M", color: "Rose", unitPricePaise: 129900, mrpPaise: 149900, quantity: 2, lineTotalPaise: 259800 },
    ],
    subtotalPaise: 259800,
    mrpTotalPaise: 299800,
    discountPaise: 10000,
    totalPaise: 249800,
    paymentMethod: "upi",
    status: "placed",
    paymentStatus: "captured",
    accessNonce: newAccessNonce(),
    // No `from`, like older stored orders.
    statusHistory: [
      { status: "pending_payment", at: new Date(Date.now() - 2000) },
      { status: "placed", at: new Date(Date.now() - 1000) },
    ],
    ...over,
  });
}

const tokenFor = async (id: Types.ObjectId) => {
  const doc = await Order.findById(id).select("+accessNonce").lean();
  return orderAccessToken(id, doc!.accessNonce!);
};

async function signUp(email: string, mobile: string) {
  const res = (await register(
    req("/api/v1/auth/register", { method: "POST", body: { fullName: "Asha Menon", email, mobile, password: "Kerala2026" } }),
    p(),
  )) as NextResponse;
  expect(res.status).toBe(201);
  const user = await User.findOne({ email }).lean();
  return { id: user!._id, jar: Object.fromEntries(res.cookies.getAll().filter((c) => c.value).map((c) => [c.name, c.value])) };
}

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  vi.stubEnv("MONGODB_URI", rs.getUri());
  vi.stubEnv("MONGODB_DB_NAME", "mm-order-status-test");
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
    const admin = await Admin.create({ name: `${key} admin`, email: `${key}@t.in`, passwordHash: await hashPassword(PW), role: role!._id });
    adminIds[key] = String(admin._id);
    const res = await login(req("/api/v1/admin/auth/login", { method: "POST", body: { identifier: `${key}@t.in`, password: PW } }), p());
    expect(res.status).toBe(200);
    jars[key] = Object.fromEntries((res as NextResponse).cookies.getAll().map((c) => [c.name, c.value]));
  }
  categoryId = (await Category.create({ slug: "kurtis", audience: "women", name: "Kurtis" }))._id;
  productId = (
    await Product.create({
      slug: "rose-kurti", name: "Rose Kurti", sku: "MM-K1", audience: "women", category: categoryId, status: "active", pricePaise: 0, mrpPaise: 0,
      variants: [{ sku: "MM-K1-M-ROSE", size: "M", color: { name: "Rose" }, pricePaise: 129900, mrpPaise: 149900, stock: 10, reserved: 3 }],
    })
  )._id;
}, 240_000);

beforeEach(async () => {
  await Promise.all([Order.deleteMany({}), AuditLog.deleteMany({}), User.deleteMany({})]);
  await Role.updateOne({ key: "staff" }, { $set: { permissions: [...DEFAULT_ROLE_PERMISSIONS.staff] } });
  resetRateLimits();
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await disconnectFromDatabase();
  await rs?.stop();
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("admin navigation", () => {
  it("has no shipping page link, and keeps orders and settings", () => {
    const links = ADMIN_NAV.flatMap((g) => g.items.map((i) => i.href));
    expect(links).not.toContain("/mm-hub/shipping");
    expect(links).toEqual(expect.arrayContaining(["/mm-hub/orders", "/mm-hub/settings"]));
  });
});

describe("order timeline", () => {
  it("shows Packed only for orders that went through it", () => {
    expect(timelineSteps({ status: "Shipped", history: {} })).not.toContain("Packed");
    expect(timelineSteps({ status: "Packed", history: {} })).toHaveLength(7);
    const steps = timelineSteps({ status: "Delivered", history: { Packed: "2026-01-01T00:00:00Z" } });
    expect(steps.indexOf("Packed")).toBe(steps.indexOf("Shipped") - 1);
  });
});

describe("manual status updates", () => {
  it("walks the whole flow with no courier, AWB, tracking link or shipment date, recording history", async () => {
    const o = await makeOrder();
    const id = o.orderNumber;
    expect((await setStatus(id, "Confirmed", {}, "staff")).status).toBe(200);
    expect((await setStatus(id, "Processing", {}, "staff")).status).toBe(200);
    expect((await adminOrder(id)).body.data.order.allowedTransitions).toEqual(["Packed", "Shipped", "Cancelled"]);
    const packed = await setStatus(id, "Packed", { note: "Box 4, fragile" }, "staff");
    expect(packed.body.data.order).toMatchObject({ status: "Packed", allowedTransitions: ["Shipped", "Cancelled"] });
    const shipped = await setStatus(id, "Shipped", {}, "manager"); // status only, nothing else sent
    expect(shipped.status).toBe(200);
    expect(shipped.body.data.order).toMatchObject({ status: "Shipped", allowedTransitions: ["Out for Delivery", "Delivered"] });
    expect(shipped.body.data.order).not.toHaveProperty("tracking");
    expect(shipped.body.data).not.toHaveProperty("couriers");
    expect((await setStatus(id, "Out for Delivery")).status).toBe(200);
    const done = await setStatus(id, "Delivered");
    expect(done.body.data.order).toMatchObject({ status: "Delivered", allowedTransitions: [] });

    expect(done.body.data.order.timeline.map((t: { from?: string; status: string }) => [t.from ?? null, t.status])).toEqual([
      [null, "Payment Pending"],
      ["Payment Pending", "Order Placed"], // derived for the older entry
      ["Order Placed", "Confirmed"],
      ["Confirmed", "Processing"],
      ["Processing", "Packed"],
      ["Packed", "Shipped"],
      ["Shipped", "Out for Delivery"],
      ["Out for Delivery", "Delivered"],
    ]);
    const doc = (await Order.findById(o._id).lean())!;
    expect(doc.tracking).toBeNull(); // no shipment record is created
    expect(doc.statusHistory).toHaveLength(8);
    expect(doc.statusHistory[4]).toMatchObject({ from: "processing", status: "packed", note: "Box 4, fragile" });
    expect(String(doc.statusHistory[4].by!.id)).toBe(adminIds.staff);
    expect(String(doc.statusHistory[5].by!.id)).toBe(adminIds.manager);
    expect(doc.statusHistory.every((h) => h.at instanceof Date)).toBe(true);
    expect(await AuditLog.countDocuments({ action: "order.status" })).toBe(6);
  });

  it("ships directly from every status that already allowed it", async () => {
    for (const status of ["placed", "confirmed", "processing", "packed"]) {
      const o = await makeOrder({ status });
      expect([status, (await setStatus(o.orderNumber, "Shipped")).status]).toEqual([status, 200]);
    }
  });

  it("ignores courier fields a stale admin tab might still send", async () => {
    const o = await makeOrder({ status: "processing" });
    expect((await setStatus(o.orderNumber, "Shipped", { courier: "X", awb: "ABC123", url: "http://x", shippedAt: "2001-01-01" })).status).toBe(200);
    expect((await Order.findById(o._id).lean())!.tracking).toBeNull();
  });

  it("refuses skipped, duplicate and backward moves", async () => {
    const o = await makeOrder();
    for (const s of ["Packed", "Out for Delivery", "Delivered"]) expect([s, (await setStatus(o.orderNumber, s)).status]).toEqual([s, 409]);
    await setStatus(o.orderNumber, "Processing");
    await setStatus(o.orderNumber, "Packed");
    for (const s of ["Packed", "Processing", "Confirmed", "Delivered"]) expect([s, (await setStatus(o.orderNumber, s)).status]).toEqual([s, 409]);
    expect((await Order.findById(o._id).lean())!.statusHistory).toHaveLength(4);
  });

  it("keeps the Cancelled and Delivered rules", async () => {
    for (const status of ["shipped", "out_for_delivery"]) {
      const o = await makeOrder({ status });
      expect([status, (await setStatus(o.orderNumber, "Cancelled")).status]).toEqual([status, 409]);
    }
    expect((await setStatus((await makeOrder({ status: "shipped" })).orderNumber, "Delivered")).status).toBe(200);
    for (const status of ["delivered", "cancelled"]) {
      const o = await makeOrder({ status });
      expect((await adminOrder(o.orderNumber)).body.data.order.allowedTransitions).toEqual([]);
      for (const s of ["Confirmed", "Processing", "Packed", "Shipped", "Out for Delivery", "Delivered", "Cancelled"]) {
        expect([status, s, (await setStatus(o.orderNumber, s)).status]).toEqual([status, s, 409]);
      }
    }
  });

  it("never moves unpaid orders forward", async () => {
    for (const over of [
      { status: "pending_payment", paymentStatus: "pending" },
      { status: "processing", paymentStatus: "pending" },
      { status: "packed", paymentStatus: "failed" },
      { status: "processing", paymentStatus: "refunded" },
    ]) {
      const o = await makeOrder(over);
      expect([over, (await setStatus(o.orderNumber, "Shipped")).status]).toEqual([over, 409]);
    }
  });

  it("bulk updates mark orders Packed then Shipped without shipment details", async () => {
    const a = await makeOrder({ status: "processing" });
    const b = await makeOrder();
    const bulk = (ids: string[], status: string) => call(bulkRoute(req("/api/v1/admin/orders/bulk-status", { method: "POST", body: { ids, status }, jar: jars.staff }), p()));
    const packed = await bulk([a.orderNumber, b.orderNumber], "Packed");
    expect(packed.body.data.updated).toEqual([a.orderNumber]);
    expect(packed.body.data.skipped.map((s: { id: string }) => s.id)).toEqual([b.orderNumber]);
    const list = await call(listAdminOrders(req("/api/v1/admin/orders?status=Packed", { jar: jars.owner }), p()));
    expect(list.body.data.items.map((i: { id: string }) => i.id)).toEqual([a.orderNumber]);
    expect(list.body.data.counts).toMatchObject({ Packed: 1, "Order Placed": 1 });
    expect((await bulk([a.orderNumber, b.orderNumber], "Shipped")).body.data.updated).toEqual([a.orderNumber, b.orderNumber]);
  });
});

describe("older orders with courier fields", () => {
  /** Written straight to the collection, exactly as older records are stored. */
  async function legacyOrder(status: string, legacy: Record<string, unknown>) {
    const o = await makeOrder({ status });
    await Order.collection.updateOne({ _id: o._id }, { $set: legacy });
    return o;
  }
  const stored = async (id: Types.ObjectId) => {
    const d = await Order.collection.findOne({ _id: id });
    return { tracking: d!.tracking, trackingHistory: d!.trackingHistory };
  };
  const when = new Date("2026-01-05T06:30:00Z");

  it("loads and updates them, leaving the stored courier data exactly as it was", async () => {
    for (const legacy of [
      { tracking: { courier: "DTDC", awb: "OLD123", url: "https://track.example/OLD123", shippedAt: when } },
      {
        tracking: { courier: "Delhivery", awb: "OLD456", url: "", shippedAt: null, expectedDeliveryAt: when, updatedAt: when, updatedBy: { type: "admin", name: "old admin" } },
        trackingHistory: [{ courier: "Delhivery", awb: "OLD456", url: "", at: when }],
      },
      { tracking: { courier: "", awb: "" } },
      { tracking: null },
    ]) {
      const o = await legacyOrder("processing", legacy);
      const before = await stored(o._id);
      expect((await adminOrder(o.orderNumber)).status).toBe(200);
      for (const s of ["Shipped", "Out for Delivery", "Delivered"]) expect([legacy, s, (await setStatus(o.orderNumber, s)).status]).toEqual([legacy, s, 200]);
      expect(await stored(o._id)).toEqual(before);
    }
  });

  it("loads and updates orders that have no courier fields at all", async () => {
    const o = await makeOrder({ status: "processing" });
    await Order.collection.updateOne({ _id: o._id }, { $unset: { tracking: "", trackingHistory: "" } });
    expect((await setStatus(o.orderNumber, "Shipped")).status).toBe(200);
    expect((await customerOrder(o.orderNumber, { token: await tokenFor(o._id) })).body.data.status).toBe("Shipped");
  });

  it("shows no courier data to staff or customers", async () => {
    const o = await legacyOrder("shipped", { tracking: { courier: "DTDC", awb: "OLD123", url: "https://track.example/OLD123", shippedAt: when, updatedAt: new Date(Date.now() + 86_400_000) } });
    const admin = await adminOrder(o.orderNumber);
    const guest = await customerOrder(o.orderNumber, { token: await tokenFor(o._id) });
    for (const r of [admin, guest]) {
      expect(r.status).toBe(200);
      const text = JSON.stringify(r.body);
      for (const value of ["DTDC", "OLD123", "track.example"]) expect(text).not.toContain(value);
    }
    // "Last updated" follows the status history only.
    expect(guest.body.data.lastUpdatedAt).toBe(guest.body.data.history["Order Placed"]);
  });
});

describe("payment, stock and pricing isolation", () => {
  it("a whole fulfilment lifecycle changes nothing about payment, stock, coupons or prices", async () => {
    const o = await makeOrder({ coupon: { coupon: new Types.ObjectId(), code: "WELCOME10", discountPaise: 10000 } });
    const snapshot = async () => {
      const order = await Order.findById(o._id).lean();
      const money = ["paymentStatus", "paymentMethod", "subtotalPaise", "mrpTotalPaise", "discountPaise", "shippingPaise", "totalPaise", "refundedPaise", "coupon", "items", "stockReleased", "paidAt", "razorpayOrderId", "razorpayPaymentId"] as const;
      const product = await Product.findById(productId).lean();
      return JSON.stringify({
        order: money.map((k) => order![k]),
        variants: product!.variants,
        soldCount: product!.soldCount,
        movements: await models.InventoryMovement.countDocuments(),
        payments: await models.Payment.countDocuments(),
        redemptions: await models.CouponRedemption.find().lean(),
        coupons: await models.Coupon.find().lean(),
      });
    };
    const before = await snapshot();
    // Payment and money fields sent to the status API are ignored.
    const sneaky = { paymentStatus: "refunded", totalPaise: 1, refundedPaise: 249800 };
    for (const s of ["Confirmed", "Processing", "Packed", "Shipped", "Out for Delivery", "Delivered"]) expect((await setStatus(o.orderNumber, s, sneaky)).status).toBe(200);
    expect(await snapshot()).toBe(before);
    expect(fetchSpy).not.toHaveBeenCalled(); // no Razorpay or any other call
  });
});

describe("permissions", () => {
  it("lets owner, manager and staff (who hold orders:write) update status", async () => {
    for (const as of ["owner", "manager", "staff"] as const) {
      const o = await makeOrder();
      expect((await adminOrder(o.orderNumber, as)).status).toBe(200);
      expect((await setStatus(o.orderNumber, "Shipped", {}, as)).status).toBe(200);
    }
  });

  it("rejects signed-out, cross-site and customer-session requests", async () => {
    const asha = await signUp("asha@example.in", "9876501234");
    const o = await makeOrder({ user: asha.id });
    expect((await adminOrder(o.orderNumber, "none")).status).toBe(401);
    expect((await setStatus(o.orderNumber, "Processing", {}, "none")).status).toBe(401);
    const attempt = (jar: Jar, origin?: string) =>
      call(statusRoute(req("/api/v1/admin/orders/" + o.orderNumber + "/status", { method: "PATCH", body: { status: "Shipped" }, jar, origin }), p({ id: o.orderNumber })));
    expect((await attempt(jars.owner, "https://evil.example")).status).toBe(403);
    expect((await attempt(asha.jar)).status).toBe(401);
    expect((await Order.findById(o._id).lean())!.status).toBe("placed");
  });

  it("follows the stored role: staff without orders:write can only read", async () => {
    await Role.updateOne({ key: "staff" }, { $pull: { permissions: "orders:write" } });
    const o = await makeOrder();
    expect((await adminOrder(o.orderNumber, "staff")).status).toBe(200);
    expect((await setStatus(o.orderNumber, "Processing", {}, "staff")).status).toBe(403);
    await Role.updateOne({ key: "staff" }, { $pull: { permissions: "orders:read" } });
    expect((await adminOrder(o.orderNumber, "staff")).status).toBe(403);
    expect((await Order.findById(o._id).lean())!.status).toBe("placed");
  });
});

describe("customer order view", () => {
  /** An order with every kind of private data attached. */
  async function notedOrder(over: Record<string, unknown> = {}) {
    const o = await makeOrder(over);
    await call(noteRoute(req("/api/v1/admin/orders/" + o.orderNumber + "/notes", { method: "POST", body: { text: "SECRET-STAFF-NOTE" }, jar: jars.staff }), p({ id: o.orderNumber })));
    await setStatus(o.orderNumber, "Processing", { note: "SECRET-STATUS-NOTE" }, "staff");
    return o;
  }
  const expectPrivate = (data: unknown) => {
    const text = JSON.stringify(data);
    for (const secret of ["SECRET", "staff admin", "owner admin", adminIds.staff, "\"tracking\"", "\"shipment\"", "statusHistory", "timeline", "notes", "accessNonce", "allowedTransitions"]) {
      expect(text).not.toContain(secret);
    }
  };

  it("shows each updated status and its history, without courier or internal data", async () => {
    const asha = await signUp("asha@example.in", "9876501234");
    const o = await notedOrder({ user: asha.id });
    for (const s of ["Packed", "Shipped", "Out for Delivery", "Delivered"]) {
      await setStatus(o.orderNumber, s, { note: "SECRET-MOVE-NOTE" });
      const r = await customerOrder(o.orderNumber, { jar: asha.jar });
      expect(r.body.data).toMatchObject({ id: o.orderNumber, status: s });
      expect(r.body.data.history[s]).toBeTruthy();
      expect(r.body.data.lastUpdatedAt).toBe(r.body.data.history[s]);
      expectPrivate(r.body.data);
    }
    const list = await call(myOrdersRoute(req("/api/v1/orders", { jar: asha.jar }), p()));
    expect(list.body.data[0].status).toBe("Delivered");
    expect(Object.keys(list.body.data[0].history)).toEqual(["Payment Pending", "Order Placed", "Processing", "Packed", "Shipped", "Out for Delivery", "Delivered"]);
    expectPrivate(list.body.data);
  });

  it("a staff note doesn't move the customer's last-updated time", async () => {
    const o = await makeOrder();
    const token = await tokenFor(o._id);
    const before = (await customerOrder(o.orderNumber, { token })).body.data.lastUpdatedAt;
    await call(noteRoute(req("/api/v1/admin/orders/" + o.orderNumber + "/notes", { method: "POST", body: { text: "internal" }, jar: jars.owner }), p({ id: o.orderNumber })));
    expect((await customerOrder(o.orderNumber, { token })).body.data.lastUpdatedAt).toBe(before);
  });

  it("another customer can't see it, by ID or in their list", async () => {
    const asha = await signUp("asha@example.in", "9876501234");
    const bala = await signUp("bala@example.in", "9876505678");
    const o = await notedOrder({ user: asha.id });
    expect((await customerOrder(o.orderNumber, { jar: bala.jar })).status).toBe(404);
    expect((await call(myOrdersRoute(req("/api/v1/orders", { jar: bala.jar }), p()))).body.data).toEqual([]);
  });

  it("guests need that order's own access token", async () => {
    const mine = await notedOrder();
    const other = await notedOrder();
    const ok = await customerOrder(mine.orderNumber, { token: await tokenFor(mine._id) });
    expect(ok.status).toBe(200);
    expectPrivate(ok.body.data);
    for (const attempt of [{}, { token: "x".repeat(43) }, { token: await tokenFor(other._id) }]) {
      expect((await customerOrder(mine.orderNumber, attempt)).status).toBe(404);
    }
  });

  it("shows a cancellation in the history", async () => {
    const o = await notedOrder();
    await setStatus(o.orderNumber, "Cancelled");
    const r = await customerOrder(o.orderNumber, { token: await tokenFor(o._id) });
    expect(r.body.data.status).toBe("Cancelled");
    expect(r.body.data.history.Cancelled).toBeTruthy();
  });
});
