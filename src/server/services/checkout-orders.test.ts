import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { Types } from "mongoose";
import { NextRequest, type NextResponse } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as saveAddress } from "@/app/api/v1/account/addresses/route";
import { PUT as editAddress } from "@/app/api/v1/account/addresses/[id]/route";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as addLine } from "@/app/api/v1/cart/items/route";
import { GET as getCartRoute } from "@/app/api/v1/cart/route";
import { POST as placeRoute } from "@/app/api/v1/checkout/orders/route";
import { POST as validateRoute } from "@/app/api/v1/checkout/validate/route";
import { GET as couponsRoute } from "@/app/api/v1/coupons/route";
import { GET as expireRoute } from "@/app/api/v1/cron/expire-orders/route";
import { GET as orderRoute } from "@/app/api/v1/orders/[id]/route";
import { GET as ordersRoute } from "@/app/api/v1/orders/route";
import { resetEnvCache } from "@/server/config/env";
import { connectToDatabase, disconnectFromDatabase } from "@/server/db/connect";
import * as models from "@/server/models";
import { Cart, Category, Coupon, CouponRedemption, InventoryMovement, Order, Product, Session, User } from "@/server/models";
import { resetRateLimits } from "@/server/security/rate-limit";


/* ---------- Harness (route handlers called directly, real transactions on a replica set) ---------- */

const ORIGIN = "http://localhost:3000";
type Jar = Record<string, string>;
const ctx = <P extends Record<string, string>>(params: P = {} as P) => ({ params: Promise.resolve(params) });
let rs: MongoMemoryReplSet;
let ipSeq = 0;

function req(
  path: string,
  init: { method?: string; body?: unknown; jar?: Jar; origin?: string | null; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { "user-agent": "vitest", "x-forwarded-for": `10.2.${++ipSeq % 250}.1`, ...init.headers };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  if (init.jar && Object.keys(init.jar).length) headers.cookie = Object.entries(init.jar).map(([k, v]) => `${k}=${v}`).join("; ");
  return new NextRequest(`${ORIGIN}${path}`, { method: init.method ?? "POST", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}
const cookiesOf = (res: Response): Jar => Object.fromEntries((res as NextResponse).cookies.getAll().filter((c) => c.value).map((c) => [c.name, c.value]));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = { success: boolean; message: string; data: any; meta?: any; error?: { code: string; issues?: { path: string; message: string }[] } };
const json = async (res: Response) => (await res.clone().json()) as Body;

async function add(jar: Jar, productId: string, size: string | null, color: string | null, quantity = 1) {
  const res = await addLine(req("/api/v1/cart/items", { body: { productId, size, color, quantity }, jar }), ctx());
  Object.assign(jar, cookiesOf(res));
  expect(res.status, (await json(res)).message).toBe(200);
}
const cartOf = async (jar: Jar) => (await json(await getCartRoute(req("/api/v1/cart", { method: "GET", jar }), ctx()))).data;

async function quote(jar: Jar, body: Record<string, unknown> = {}) {
  const res = await validateRoute(req("/api/v1/checkout/validate", { body: { source: { type: "cart" }, ...body }, jar }), ctx());
  return { status: res.status, body: await json(res) };
}

const CUSTOMER = { fullName: "Anitha Menon", email: "anitha@example.com", mobile: "9876543210" };
const ADDRESS = { house: "12 Rose Villa", street: "MG Road", city: "Kochi", district: "Ernakulam", state: "Kerala", pincode: "682001" };
let keySeq = 0;
const newKey = () => `test-key-${Date.now()}-${++keySeq}-abcdef`;

async function place(jar: Jar, body: Record<string, unknown>, opts: { origin?: string | null } = {}) {
  const payload = { source: { type: "cart" }, customer: CUSTOMER, address: ADDRESS, paymentMethod: "upi", idempotencyKey: newKey(), ...body };
  const res = await placeRoute(req("/api/v1/checkout/orders", { body: payload, jar, origin: opts.origin }), ctx());
  Object.assign(jar, cookiesOf(res));
  return { status: res.status, body: await json(res), payload };
}

/** Quote first, then place with the total the shopper was shown. */
async function checkout(jar: Jar, body: Record<string, unknown> = {}) {
  const q = await quote(jar, { source: body.source ?? { type: "cart" }, couponCode: body.couponCode ?? null });
  expect(q.status).toBe(200);
  return place(jar, { expectedTotalPaise: q.body.data.amounts.totalPaise, ...body });
}

const getOrder = async (id: string, opts: { jar?: Jar; token?: string } = {}) =>
  orderRoute(req(`/api/v1/orders/${id}`, { method: "GET", jar: opts.jar, headers: opts.token ? { "x-order-token": opts.token } : {} }), ctx({ id }));

let mobileSeq = 0;
async function signUp(email: string): Promise<Jar> {
  const mobile = `98${String(70000000 + ++mobileSeq).padStart(8, "0")}`;
  const res = await register(req("/api/v1/auth/register", { body: { fullName: "Test Shopper", email, mobile, password: "Kerala2026" } }), ctx());
  expect(res.status).toBe(201);
  return cookiesOf(res);
}

const variant = async (sku: string) => {
  const p = await Product.findOne({ "variants.sku": sku }, { variants: 1, inStock: 1 }).lean();
  return { ...p!.variants.find((v) => v.sku === sku)!, inStock: p!.inStock };
};

/* ---------- Fixtures ---------- */

let kurti: string; // women: M/L Rose, M Ivory (fully reserved); variant prices differ
let shirt: string; // men
let bedsheet: string; // home & living: King ₹1,499 vs Queen ₹1,299 (product-level price is the lowest)
let lastOne: string; // one unit only
let hidden: string;
let menShirts: Types.ObjectId;

const STOCK: Record<string, { stock: number; reserved: number }> = {
  "MM-K1-M-ROSE": { stock: 5, reserved: 0 },
  "MM-K1-L-ROSE": { stock: 2, reserved: 0 },
  "MM-K1-M-IVORY": { stock: 3, reserved: 3 },
  "MM-S1-40": { stock: 30, reserved: 0 },
  "MM-B1-KING": { stock: 4, reserved: 0 },
  "MM-B1-QUEEN": { stock: 6, reserved: 0 },
  "MM-L1-FREE": { stock: 1, reserved: 0 },
  "MM-DR-M": { stock: 9, reserved: 0 },
};

async function seedCatalogue() {
  type Aud = "women" | "men" | "kids" | "home-living";
  const cat = async (slug: string, audience: Aud) => (await Category.create({ slug, audience, name: slug }))._id;
  const base = { pricePaise: 0, mrpPaise: 0, status: "active" as const, images: [{ url: "https://img.example/x.jpg" }] };
  const women = await cat("kurtis", "women");
  menShirts = await cat("men-shirts", "men");
  kurti = (
    await Product.create({
      ...base, legacyId: "p001", slug: "rose-kurti", name: "Rose Kurti", sku: "MM-K1", audience: "women", category: women,
      variants: [
        { sku: "MM-K1-M-ROSE", size: "M", color: { name: "Rose" }, pricePaise: 129900, mrpPaise: 189900, stock: 5 },
        { sku: "MM-K1-L-ROSE", size: "L", color: { name: "Rose" }, pricePaise: 139900, mrpPaise: 189900, stock: 2 },
        { sku: "MM-K1-M-IVORY", size: "M", color: { name: "Ivory" }, pricePaise: 129900, mrpPaise: 189900, stock: 3, reserved: 3 },
      ],
    })
  ).legacyId!;
  shirt = (
    await Product.create({
      ...base, slug: "linen-shirt", name: "Linen Shirt", sku: "MM-S1", audience: "men", category: menShirts,
      variants: [{ sku: "MM-S1-40", size: "40", pricePaise: 99900, mrpPaise: 99900, stock: 30 }],
    })
  ).id;
  bedsheet = (
    await Product.create({
      ...base, slug: "cotton-bedsheet", name: "Cotton Bedsheet", sku: "MM-B1", audience: "home-living", category: await cat("home-bedsheets", "home-living"),
      variants: [
        { sku: "MM-B1-KING", size: "King", pricePaise: 149900, mrpPaise: 199900, stock: 4 },
        { sku: "MM-B1-QUEEN", size: "Queen", pricePaise: 129900, mrpPaise: 179900, stock: 6 },
      ],
    })
  ).id;
  lastOne = (
    await Product.create({
      ...base, slug: "last-saree", name: "Last Saree", sku: "MM-L1", audience: "women", category: women,
      variants: [{ sku: "MM-L1-FREE", size: "Free Size", pricePaise: 249900, mrpPaise: 249900, stock: 1 }],
    })
  ).id;
  hidden = (
    await Product.create({
      ...base, status: "draft" as const, slug: "draft-dress", name: "Draft Dress", sku: "MM-DR", audience: "women", category: women,
      variants: [{ sku: "MM-DR-M", size: "M", pricePaise: 99900, mrpPaise: 99900, stock: 9 }],
    })
  ).id;
}

const DAY = 24 * 60 * 60 * 1000;
async function seedCoupons() {
  const past = new Date(Date.now() - 10 * DAY);
  await Coupon.create([
    { code: "WELCOME10", type: "percent", value: 10, maxDiscountPaise: 40000, description: "10% off your order (up to ₹400)", startsAt: past },
    { code: "FIRSTORDER", type: "flat", value: 10000, minOrderPaise: 79900, description: "Flat ₹100 off on orders above ₹799", startsAt: past },
    { code: "SAVE15", type: "percent", value: 15, minOrderPaise: 199900, maxDiscountPaise: 75000, startsAt: past },
    { code: "EXPIRED5", type: "percent", value: 5, startsAt: past, endsAt: new Date(Date.now() - DAY) },
    { code: "SOON", type: "percent", value: 5, startsAt: new Date(Date.now() + DAY) },
    { code: "PAUSED", type: "percent", value: 5, startsAt: past, active: false },
    { code: "SECRET", type: "flat", value: 5000, startsAt: past, listed: false },
    { code: "LIMITED", type: "flat", value: 5000, startsAt: past, usageLimit: 1 },
    { code: "ONCE", type: "flat", value: 5000, startsAt: past, perCustomerLimit: 1 },
    { code: "MENONLY", type: "percent", value: 50, startsAt: past, categories: [menShirts] },
  ] as never);
}

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  vi.stubEnv("MONGODB_URI", rs.getUri());
  vi.stubEnv("MONGODB_DB_NAME", "mm-checkout-test");
  vi.stubEnv("JWT_ACCESS_SECRET", "a".repeat(48));
  vi.stubEnv("JWT_REFRESH_SECRET", "r".repeat(48));
  vi.stubEnv("CRON_SECRET", "c".repeat(32));
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  resetEnvCache();
  await connectToDatabase();
  for (const m of Object.values(models)) {
    await m.createCollection();
    await m.syncIndexes();
  }
  await seedCatalogue();
}, 240_000);

beforeEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([
    Cart.deleteMany({}), User.deleteMany({}), Session.deleteMany({}), Order.deleteMany({}), CouponRedemption.deleteMany({}),
    InventoryMovement.deleteMany({}), Coupon.deleteMany({}),
  ]);
  await seedCoupons();
  for (const [sku, s] of Object.entries(STOCK)) {
    await Product.updateOne({ "variants.sku": sku }, { $set: { "variants.$.stock": s.stock, "variants.$.reserved": s.reserved, "variants.$.pricePaise": sku === "MM-K1-L-ROSE" ? 139900 : sku === "MM-B1-KING" ? 149900 : sku === "MM-B1-QUEEN" ? 129900 : sku === "MM-S1-40" ? 99900 : sku === "MM-L1-FREE" ? 249900 : sku === "MM-DR-M" ? 99900 : 129900, inStock: true } });
  }
  await Product.updateOne({ slug: "rose-kurti" }, { $set: { status: "active", name: "Rose Kurti" } });
  resetRateLimits();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await disconnectFromDatabase();
  await rs?.stop();
});

/* ---------- Checkout ---------- */

describe("checkout validation and pricing", () => {
  it("quotes the bag from live variant prices — the exact size, not the product's lowest price", async () => {
    const jar: Jar = {};
    await add(jar, kurti, "L", "Rose", 1); // ₹1,399 (product-level price is ₹1,299)
    await add(jar, bedsheet, "King", null, 2); // ₹1,499 each (Queen is ₹1,299)
    await add(jar, shirt, "40", null, 1); // ₹999
    const { status, body } = await quote(jar);
    expect(status).toBe(200);
    const q = body.data;
    expect(q.items.map((i: { key: string; price: number }) => [i.key, i.price])).toEqual(
      expect.arrayContaining([["MM-K1-L-ROSE", 1399], ["MM-B1-KING", 1499], ["MM-S1-40", 999]]),
    );
    expect(q.amounts).toEqual({ subtotalPaise: 139900 + 2 * 149900 + 99900, mrpTotalPaise: 189900 + 2 * 199900 + 99900, discountPaise: 0, totalPaise: 539600 });
    expect(q.totals).toMatchObject({ itemCount: 4, subtotal: 5396, total: 5396, shipping: null });
    expect(q.canPlaceOrder).toBe(true);
    expect(q.currency).toBe("INR");
  });

  it("reports hidden products, unknown variants, sold-out variants and short stock as blocking issues", async () => {
    const buyNow = (item: Record<string, unknown>) => quote({}, { source: { type: "buy-now", item } });
    const issue = async (item: Record<string, unknown>) => (await buyNow(item)).body.data;

    let q = await issue({ productId: hidden, size: "M", color: null, quantity: 1 });
    expect(q.canPlaceOrder).toBe(false);
    expect(q.issues[0]).toMatchObject({ code: "unavailable", blocking: true });

    q = await issue({ productId: kurti, size: "XXL", color: "Rose", quantity: 1 });
    expect(q.issues[0]).toMatchObject({ code: "unavailable" });
    expect(q.issues[0].message).toMatch(/size and colour combination/);

    q = await issue({ productId: kurti, size: "M", color: "Ivory", quantity: 1 }); // stock 3, reserved 3
    expect(q.issues[0]).toMatchObject({ code: "out_of_stock", sku: "MM-K1-M-IVORY" });

    q = await issue({ productId: kurti, size: "L", color: "Rose", quantity: 3 }); // only 2
    expect(q.issues[0]).toMatchObject({ code: "insufficient_stock" });
    expect(q.issues[0].message).toMatch(/Only 2/);

    // An item hidden after it was added to the bag.
    const jar: Jar = {};
    await add(jar, kurti, "M", "Rose", 1);
    await Product.updateOne({ slug: "rose-kurti" }, { $set: { status: "draft" } });
    q = (await quote(jar)).body.data;
    expect(q.canPlaceOrder).toBe(false);
    expect(q.issues[0].code).toBe("unavailable");
    const placed = await place(jar, { expectedTotalPaise: 129900 });
    expect(placed.status).toBe(409);
    expect(placed.body.error?.code).toBe("CART_CHANGED");
  });

  it("rejects invalid quantities and malformed requests with 400", async () => {
    for (const quantity of [0, 21, 1.5, "2"]) {
      const { status, body } = await quote({}, { source: { type: "buy-now", item: { productId: kurti, size: "M", color: "Rose", quantity } } });
      expect(status).toBe(400);
      expect(body.error?.code).toBe("VALIDATION_ERROR");
    }
    expect((await quote({}, { source: { type: "everything" } })).status).toBe(400);
    expect((await quote({}, { couponCode: "<script>" })).status).toBe(400);
  });

  it("flags a price change since the shopper last saw it, and refuses an order at the old total", async () => {
    const jar: Jar = {};
    await add(jar, kurti, "M", "Rose", 2);
    const seen = (await quote(jar)).body.data;
    expect(seen.amounts.totalPaise).toBe(259800);

    await Product.updateOne({ "variants.sku": "MM-K1-M-ROSE" }, { $set: { "variants.$.pricePaise": 149900 } });
    const stale = await place(jar, { expectedTotalPaise: 259800 });
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe("PRICE_CHANGED");
    expect(stale.body.message).toMatch(/₹2,998/);
    expect((await cartOf(jar)).items).toHaveLength(1); // bag kept
    expect((await variant("MM-K1-M-ROSE")).reserved).toBe(0); // nothing reserved

    const fresh = (await quote(jar, { expectedPrices: { "MM-K1-M-ROSE": 129900 } })).body.data;
    expect(fresh.issues).toEqual([expect.objectContaining({ code: "price_changed", blocking: false })]);
    expect(fresh.issues[0].message).toMatch(/₹1,299 to ₹1,499/);
    expect(fresh.canPlaceOrder).toBe(true);

    const ok = await place(jar, { expectedTotalPaise: fresh.amounts.totalPaise });
    expect(ok.status).toBe(201);
    expect(ok.body.data.order.items[0]).toMatchObject({ price: 1499, sku: "MM-K1-M-ROSE" });
  });

  it("ignores prices, discounts and totals sent by the browser", async () => {
    const jar: Jar = {};
    await add(jar, shirt, "40", null, 1);
    const tampered = await place(jar, {
      expectedTotalPaise: 100,
      items: [{ productId: shirt, price: 1, quantity: 1 }],
      totals: { total: 1 },
      discountPaise: 99800,
      unitPricePaise: 100,
    });
    expect(tampered.status).toBe(409);
    expect(tampered.body.error?.code).toBe("PRICE_CHANGED");

    const real = await checkout(jar, { discountPaise: 99800, subtotalPaise: 100 });
    expect(real.status).toBe(201);
    const order = await Order.findOne({ orderNumber: real.body.data.order.id }).lean();
    expect(order).toMatchObject({ subtotalPaise: 99900, discountPaise: 0, totalPaise: 99900 });
  });
});

describe("placing orders", () => {
  it("guest checkout: snapshots everything, reserves the exact variants, writes the ledger and empties the bag", async () => {
    const jar: Jar = {};
    await add(jar, kurti, "M", "Rose", 2);
    await add(jar, bedsheet, "King", null, 1);
    const { status, body } = await checkout(jar);
    expect(status).toBe(201);
    const { order, accessToken } = body.data;
    expect(order.id).toMatch(/^MM[2-9A-Z]{8}$/);
    expect(order).toMatchObject({ status: "Payment Pending", subtotal: 4097, discount: 0, total: 4097, shipping: null, paymentMethod: "upi", customer: CUSTOMER });
    expect(order.reservedUntil).toBeTruthy();
    expect(typeof accessToken).toBe("string");
    // Nothing internal leaks.
    const raw = JSON.stringify(body);
    for (const secret of ["_id", "accessNonce", "idempotencyKey", "guestId", "\"user\""]) expect(raw).not.toContain(secret);

    const doc = await Order.findOne({ orderNumber: order.id }).lean();
    expect(doc).toMatchObject({
      user: null, currency: "INR", status: "pending_payment", paymentStatus: "pending", shippingPaise: null, stockReleased: false,
      subtotalPaise: 409700, mrpTotalPaise: 2 * 189900 + 199900, discountPaise: 0, totalPaise: 409700,
      shippingAddress: { ...ADDRESS, country: "India" },
    });
    expect(doc!.items.map((i) => [i.variantSku, i.size, i.color, i.quantity, i.unitPricePaise, i.mrpPaise, i.lineTotalPaise, i.name, i.image?.url])).toEqual([
      ["MM-K1-M-ROSE", "M", "Rose", 2, 129900, 189900, 259800, "Rose Kurti", "https://img.example/x.jpg"],
      ["MM-B1-KING", "King", null, 1, 149900, 199900, 149900, "Cotton Bedsheet", "https://img.example/x.jpg"],
    ]);
    const holdMinutes = (+doc!.reservationExpiresAt! - +doc!.createdAt) / 60000;
    expect(holdMinutes).toBeCloseTo(30, 0);

    expect(await variant("MM-K1-M-ROSE")).toMatchObject({ stock: 5, reserved: 2 });
    expect(await variant("MM-B1-KING")).toMatchObject({ stock: 4, reserved: 1 });
    const ledger = await InventoryMovement.find({ order: doc!._id }).sort({ variantSku: 1 }).lean();
    expect(ledger.map((m) => [m.variantSku, m.type, m.stockChange, m.reservedChange, m.stockAfter, m.reservedAfter])).toEqual([
      ["MM-B1-KING", "reservation", 0, 1, 4, 1],
      ["MM-K1-M-ROSE", "reservation", 0, 2, 5, 2],
    ]);
    expect((await cartOf(jar)).items).toEqual([]);
  });

  it("requires full, valid contact and Indian delivery details", async () => {
    const jar: Jar = {};
    await add(jar, shirt, "40", null, 1);
    const bad = await place(jar, {
      expectedTotalPaise: 99900,
      customer: { fullName: "A", email: "not-an-email", mobile: "12345" },
      address: { ...ADDRESS, pincode: "012345", state: "California" },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error?.issues?.map((i) => i.path).sort()).toEqual(["address.pincode", "address.state", "customer.email", "customer.fullName", "customer.mobile"]);

    const abroad = await place(jar, { expectedTotalPaise: 99900, address: { ...ADDRESS, country: "USA" } });
    expect(abroad.status).toBe(400);
    const noAddress = await place(jar, { expectedTotalPaise: 99900, address: undefined });
    expect(noAddress.status).toBe(400);
    const noMethod = await place(jar, { expectedTotalPaise: 99900, paymentMethod: "cod" });
    expect(noMethod.status).toBe(400);
    expect(await Order.countDocuments()).toBe(0);
  });

  it("authenticated checkout with a saved address keeps a snapshot that later edits don't change", async () => {
    const jar = await signUp("meera@example.com");
    const saved = await saveAddress(req("/api/v1/account/addresses", { body: { ...ADDRESS, label: "Home" }, jar }), ctx());
    const addressId = (await json(saved)).data[0].id;
    await add(jar, kurti, "M", "Rose", 1);

    const { status, body } = await checkout(jar, { addressId, address: undefined, customer: { ...CUSTOMER, email: "meera@example.com" } });
    expect(status).toBe(201);
    expect(body.data.accessToken).toBeNull(); // customers read their orders through their session
    const user = await User.findOne({ email: "meera@example.com" }).lean();
    const doc = await Order.findOne({ orderNumber: body.data.order.id }).lean();
    expect(String(doc!.user)).toBe(String(user!._id));
    expect(doc!.shippingAddress).toMatchObject(ADDRESS);

    // Later edits to the address and the product don't touch the order.
    await editAddress(req(`/api/v1/account/addresses/${addressId}`, { method: "PUT", body: { ...ADDRESS, house: "99 New House" }, jar }), ctx({ id: addressId }));
    await Product.updateOne({ slug: "rose-kurti" }, { $set: { name: "Renamed Kurti", "variants.0.pricePaise": 99900 } });
    const view = (await json(await getOrder(body.data.order.id, { jar }))).data;
    expect(view.address.house).toBe("12 Rose Villa");
    expect(view.items[0]).toMatchObject({ name: "Rose Kurti", price: 1299 });
    expect((await cartOf(jar)).items).toEqual([]);
  });

  it("refuses an address that belongs to someone else (or a saved address without logging in)", async () => {
    const owner = await signUp("owner@example.com");
    const saved = await saveAddress(req("/api/v1/account/addresses", { body: ADDRESS, jar: owner }), ctx());
    const addressId = (await json(saved)).data[0].id;

    const other = await signUp("other@example.com");
    await add(other, shirt, "40", null, 1);
    const stolen = await checkout(other, { addressId, address: undefined });
    expect(stolen.status).toBe(404);

    const guest: Jar = {};
    await add(guest, shirt, "40", null, 1);
    const guestTry = await checkout(guest, { addressId, address: undefined });
    expect(guestTry.status).toBe(400);
    expect(await Order.countDocuments()).toBe(0);
    expect((await variant("MM-S1-40")).reserved).toBe(0);
  });

  it("Buy Now orders one variant and leaves the bag alone", async () => {
    const jar: Jar = {};
    await add(jar, shirt, "40", null, 3);
    const source = { type: "buy-now", item: { productId: bedsheet, size: "King", color: null, quantity: 2 } };
    const { status, body } = await checkout(jar, { source });
    expect(status).toBe(201);
    expect(body.data.order.items).toEqual([expect.objectContaining({ sku: "MM-B1-KING", price: 1499, quantity: 2 })]);
    expect((await cartOf(jar)).items).toEqual([expect.objectContaining({ key: "MM-S1-40", quantity: 3 })]);
  });

  it("an empty bag can't be ordered", async () => {
    const res = await place({}, { expectedTotalPaise: 100 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/empty/i);
  });

  it("blocks cross-site requests", async () => {
    const jar: Jar = {};
    await add(jar, shirt, "40", null, 1);
    expect((await place(jar, { expectedTotalPaise: 99900 }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await place(jar, { expectedTotalPaise: 99900 }, { origin: null })).status).toBe(403);
    const res = await validateRoute(req("/api/v1/checkout/validate", { body: { source: { type: "cart" } }, jar, origin: "https://evil.example" }), ctx());
    expect(res.status).toBe(403);
    expect(await Order.countDocuments()).toBe(0);
  });

  it("gives every order a unique order number", async () => {
    const numbers = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const r = await checkout({}, { source: { type: "buy-now", item: { productId: shirt, size: "40", color: null, quantity: 1 } } });
      expect(r.status).toBe(201);
      numbers.add(r.body.data.order.id);
    }
    expect(numbers.size).toBe(6);
  });
});

/* ---------- Idempotency ---------- */

describe("duplicate submissions", () => {
  it("returns the same order for a repeated request key — sequentially or at the same moment", async () => {
    const jar: Jar = {};
    await add(jar, kurti, "M", "Rose", 1);
    const total = (await quote(jar)).body.data.amounts.totalPaise;
    const idempotencyKey = newKey();
    const send = () => place(jar, { expectedTotalPaise: total, idempotencyKey });

    const results = await Promise.all([send(), send(), send()]);
    const created = results.filter((r) => r.status === 201);
    expect(created).toHaveLength(1);
    expect(results.every((r) => r.status === 201 || r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.data.order.id)).size).toBe(1);
    // The replay hands back a working access token too.
    expect(new Set(results.map((r) => r.body.data.accessToken)).size).toBe(1);

    const again = await send();
    expect(again.status).toBe(200);
    expect(again.body.data.order.id).toBe(results[0].body.data.order.id);

    expect(await Order.countDocuments()).toBe(1);
    expect((await variant("MM-K1-M-ROSE")).reserved).toBe(1);
    expect(await InventoryMovement.countDocuments({ type: "reservation" })).toBe(1);
  });

  it("scopes keys to the shopper — another shopper's key doesn't return their order", async () => {
    const key = newKey();
    const a: Jar = {};
    const b: Jar = {};
    await add(a, shirt, "40", null, 1);
    await add(b, shirt, "40", null, 1);
    const ra = await checkout(a, { idempotencyKey: key });
    const rb = await checkout(b, { idempotencyKey: key });
    expect([ra.status, rb.status]).toEqual([201, 201]);
    expect(ra.body.data.order.id).not.toBe(rb.body.data.order.id);
  });
});

/* ---------- Coupons ---------- */

describe("coupons (server-side only)", () => {
  async function couponQuote(lines: [string, string | null, string | null, number][], code: string) {
    const jar: Jar = {};
    for (const l of lines) await add(jar, ...l);
    return { jar, q: (await quote(jar, { couponCode: code })).body.data };
  }

  it("percentage discount, rounded down to whole rupees", async () => {
    const { q } = await couponQuote([[kurti, "M", "Rose", 2]], "welcome10");
    expect(q.coupon).toMatchObject({ code: "WELCOME10", status: "applied", discount: 259 });
    expect(q.amounts).toMatchObject({ subtotalPaise: 259800, discountPaise: 25900, totalPaise: 233900 });
    expect(q.totals.savings).toBe((2 * 189900 - 259800 + 25900) / 100);
  });

  it("respects the maximum discount cap", async () => {
    const { q } = await couponQuote([[kurti, "M", "Rose", 5]], "WELCOME10"); // 10% of ₹6,495 = ₹649 → capped at ₹400
    expect(q.amounts.discountPaise).toBe(40000);
  });

  it("fixed discount, with its minimum order value", async () => {
    let { q } = await couponQuote([[kurti, "M", "Rose", 1]], "FIRSTORDER");
    expect(q.amounts).toMatchObject({ discountPaise: 10000, totalPaise: 119900 });
    ({ q } = await couponQuote([[kurti, "M", "Rose", 1]], "SAVE15")); // needs ₹1,999
    expect(q.coupon).toMatchObject({ status: "rejected", discount: 0 });
    expect(q.coupon.message).toBe("SAVE15 needs a minimum order of ₹1,999. Add ₹700 more to use it.");
    expect(q.amounts.discountPaise).toBe(0);
    expect(q.canPlaceOrder).toBe(false);
  });

  it("rejects unknown, expired, not-yet-started and switched-off coupons with clear messages", async () => {
    const cases: [string, RegExp][] = [
      ["NOPE", /"NOPE" is not a valid coupon code/],
      ["EXPIRED5", /has expired/],
      ["SOON", /isn't active yet/],
      ["PAUSED", /no longer available/],
    ];
    for (const [code, message] of cases) {
      const { q } = await couponQuote([[shirt, "40", null, 1]], code);
      expect(q.coupon.status).toBe("rejected");
      expect(q.coupon.message).toMatch(message);
    }
  });

  it("applies category-restricted coupons only to eligible items", async () => {
    let { q } = await couponQuote([[kurti, "M", "Rose", 1]], "MENONLY");
    expect(q.coupon.message).toMatch(/doesn't apply/);
    ({ q } = await couponQuote([[kurti, "M", "Rose", 1], [shirt, "40", null, 1]], "MENONLY"));
    expect(q.amounts.discountPaise).toBe(49900); // 50% of the ₹999 shirt only, rounded down
  });

  it("an order stores the coupon, its redemption and the server's discount; a bad coupon fails the order and keeps the bag", async () => {
    const jar: Jar = {};
    await add(jar, kurti, "M", "Rose", 2);
    const ok = await checkout(jar, { couponCode: "WELCOME10" });
    expect(ok.status).toBe(201);
    expect(ok.body.data.order).toMatchObject({ couponCode: "WELCOME10", discount: 259, total: 2339 });
    const doc = await Order.findOne({ orderNumber: ok.body.data.order.id }).lean();
    expect(doc!.coupon).toMatchObject({ code: "WELCOME10", discountPaise: 25900 });
    expect(await CouponRedemption.findOne({ order: doc!._id }).lean()).toMatchObject({ code: "WELCOME10", status: "reserved", discountPaise: 25900, email: CUSTOMER.email });
    expect((await Coupon.findOne({ code: "WELCOME10" }).lean())!.usageCount).toBe(1);

    const jar2: Jar = {};
    await add(jar2, kurti, "M", "Rose", 1);
    const expired = await place(jar2, { couponCode: "EXPIRED5", expectedTotalPaise: 123405 });
    expect(expired.status).toBe(409);
    expect(expired.body.error?.code).toBe("COUPON_INVALID");
    expect(expired.body.message).toMatch(/has expired/);
    expect((await cartOf(jar2)).items).toHaveLength(1);
    expect(await Order.countDocuments()).toBe(1);
  });

  it("enforces the usage limit", async () => {
    const first: Jar = {};
    await add(first, shirt, "40", null, 1);
    expect((await checkout(first, { couponCode: "LIMITED" })).status).toBe(201);

    const second: Jar = {};
    await add(second, shirt, "40", null, 1);
    const q = (await quote(second, { couponCode: "LIMITED" })).body.data;
    expect(q.coupon.message).toMatch(/reached its usage limit/);
    const res = await place(second, { couponCode: "LIMITED", expectedTotalPaise: 94900 });
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("COUPON_INVALID");
  });

  it("enforces the per-customer limit by account and by email", async () => {
    const a: Jar = {};
    await add(a, shirt, "40", null, 1);
    expect((await checkout(a, { couponCode: "ONCE" })).status).toBe(201);

    const sameEmail: Jar = {};
    await add(sameEmail, shirt, "40", null, 1);
    const again = await place(sameEmail, { couponCode: "ONCE", expectedTotalPaise: 94900 });
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/already used ONCE/);

    const otherEmail = await place(sameEmail, { couponCode: "ONCE", expectedTotalPaise: 94900, customer: { ...CUSTOMER, email: "someone.else@example.com" } });
    expect(otherEmail.status).toBe(201);

    // A signed-in customer is counted by account, whatever email they type.
    const member = await signUp("member@example.com");
    await add(member, shirt, "40", null, 1);
    expect((await checkout(member, { couponCode: "ONCE", customer: { ...CUSTOMER, email: "member@example.com" } })).status).toBe(201);
    await add(member, shirt, "40", null, 1);
    const q = (await quote(member, { couponCode: "ONCE" })).body.data;
    expect(q.coupon.message).toMatch(/already used ONCE/);
  });

  it("concurrent orders can't exceed a coupon's usage limit", async () => {
    const shoppers: Jar[] = [];
    for (let i = 0; i < 6; i++) {
      const jar: Jar = {};
      await add(jar, shirt, "40", null, 1);
      shoppers.push(jar);
    }
    const results = await Promise.all(
      shoppers.map((jar, i) => place(jar, { couponCode: "LIMITED", expectedTotalPaise: 94900, customer: { ...CUSTOMER, email: `buyer${i}@example.com` } })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409 && r.body.error?.code === "COUPON_INVALID")).toHaveLength(5);
    expect((await Coupon.findOne({ code: "LIMITED" }).lean())!.usageCount).toBe(1);
    expect(await CouponRedemption.countDocuments({ code: "LIMITED" })).toBe(1);
    expect((await variant("MM-S1-40")).reserved).toBe(1);
  });

  it("lists only advertisable coupons", async () => {
    const res = await couponsRoute(req("/api/v1/coupons", { method: "GET" }), ctx());
    const codes = (await json(res)).data.map((c: { code: string }) => c.code);
    expect(codes.sort()).toEqual(["FIRSTORDER", "LIMITED", "MENONLY", "ONCE", "SAVE15", "WELCOME10"]);
    await Coupon.updateOne({ code: "LIMITED" }, { $set: { usageCount: 1 } });
    const after = (await json(await couponsRoute(req("/api/v1/coupons", { method: "GET" }), ctx()))).data;
    expect(after.map((c: { code: string }) => c.code)).not.toContain("LIMITED");
    expect(after.find((c: { code: string }) => c.code === "FIRSTORDER")).toEqual({
      code: "FIRSTORDER", description: "Flat ₹100 off on orders above ₹799", type: "flat", value: 100, minOrder: 799, maxDiscount: null,
    });
  });
});

/* ---------- Inventory & concurrency ---------- */

describe("stock reservation", () => {
  it("simultaneous checkouts for the last units never oversell", async () => {
    const buyers: Jar[] = [];
    for (let i = 0; i < 6; i++) {
      const jar: Jar = {};
      await add(jar, kurti, "L", "Rose", 1); // 2 in stock
      buyers.push(jar);
    }
    const results = await Promise.all(buyers.map((jar) => place(jar, { expectedTotalPaise: 139900 })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409 && r.body.error?.code === "CART_CHANGED")).toHaveLength(4);
    expect(await variant("MM-K1-L-ROSE")).toMatchObject({ stock: 2, reserved: 2 });
    expect(await InventoryMovement.countDocuments({ variantSku: "MM-K1-L-ROSE", type: "reservation" })).toBe(2);
    expect(await Order.countDocuments()).toBe(2);
    // Losers' bags are untouched in the database (the bag view then hides the now-sold-out line).
    const bags = await Cart.find({}, { items: 1 }).lean();
    expect(bags.filter((b) => b.items.length === 1)).toHaveLength(4);
    expect(bags.filter((b) => b.items.length === 0)).toHaveLength(2);
  });

  it("refuses an order for more than is available, and marks the product out of stock once its last unit is held", async () => {
    const jar: Jar = {};
    await add(jar, lastOne, "Free Size", null, 1);
    expect((await variant("MM-L1-FREE")).inStock).toBe(true);
    expect((await checkout(jar)).status).toBe(201);
    expect(await variant("MM-L1-FREE")).toMatchObject({ stock: 1, reserved: 1, inStock: false });

    const late = await place({}, { source: { type: "buy-now", item: { productId: lastOne, size: "Free Size", color: null, quantity: 1 } }, expectedTotalPaise: 249900 });
    expect(late.status).toBe(409);
    expect(late.body.error?.code).toBe("CART_CHANGED");
    expect(late.body.message).toMatch(/out of stock/);
  });

  it("rolls everything back when any step of the order fails", async () => {
    const jar: Jar = {};
    await add(jar, kurti, "M", "Rose", 2);
    const total = (await quote(jar, { couponCode: "WELCOME10" })).body.data.amounts.totalPaise;
    // Fail at the very last write (after stock was reserved, the coupon taken and the order inserted).
    vi.spyOn(CouponRedemption, "create").mockRejectedValueOnce(new Error("simulated outage"));
    const res = await place(jar, { couponCode: "WELCOME10", expectedTotalPaise: total });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("simulated");

    expect(await Order.countDocuments()).toBe(0);
    expect(await variant("MM-K1-M-ROSE")).toMatchObject({ stock: 5, reserved: 0 });
    expect(await InventoryMovement.countDocuments()).toBe(0);
    expect((await Coupon.findOne({ code: "WELCOME10" }).lean())!.usageCount).toBe(0);
    expect((await cartOf(jar)).items).toHaveLength(1);

    // And the same request succeeds once the problem is gone.
    expect((await place(jar, { couponCode: "WELCOME10", expectedTotalPaise: total })).status).toBe(201);
  });

  it("expiring an unpaid order releases its stock and coupon exactly once (ledger 'release')", async () => {
    const jar: Jar = {};
    await add(jar, kurti, "M", "Rose", 2);
    await add(jar, lastOne, "Free Size", null, 1);
    const { body } = await checkout(jar, { couponCode: "WELCOME10" });
    const orderNumber = body.data.order.id;
    expect(await variant("MM-L1-FREE")).toMatchObject({ reserved: 1, inStock: false });

    const cron = (auth?: string) => expireRoute(req("/api/v1/cron/expire-orders", { method: "GET", headers: auth ? { authorization: auth } : {} }), ctx());
    expect((await cron()).status).toBe(401);
    expect((await cron("Bearer wrong")).status).toBe(401);
    expect((await json(await cron(`Bearer ${"c".repeat(32)}`))).data).toEqual({ checked: 0, expired: 0 }); // not due yet

    await Order.updateOne({ orderNumber }, { $set: { reservationExpiresAt: new Date(Date.now() - 1000) } });
    const run = await Promise.all([cron(`Bearer ${"c".repeat(32)}`), cron(`Bearer ${"c".repeat(32)}`)]);
    expect(run.every((r) => r.status === 200)).toBe(true);
    const totals = await Promise.all(run.map(async (r) => (await json(r)).data.expired));
    expect(totals.reduce((a, b) => a + b, 0)).toBe(1);

    const doc = await Order.findOne({ orderNumber }).lean();
    expect(doc).toMatchObject({ status: "expired", stockReleased: true });
    expect(await variant("MM-K1-M-ROSE")).toMatchObject({ stock: 5, reserved: 0 });
    expect(await variant("MM-L1-FREE")).toMatchObject({ stock: 1, reserved: 0, inStock: true });
    const release = await InventoryMovement.find({ order: doc!._id, type: "release" }).lean();
    expect(release.map((m) => [m.variantSku, m.reservedChange, m.reservedAfter]).sort()).toEqual([["MM-K1-M-ROSE", -2, 0], ["MM-L1-FREE", -1, 0]]);
    expect(await CouponRedemption.findOne({ order: doc!._id }).lean()).toMatchObject({ status: "released" });
    expect((await Coupon.findOne({ code: "WELCOME10" }).lean())!.usageCount).toBe(0);

    const view = (await json(await getOrder(orderNumber, { token: body.data.accessToken }))).data;
    expect(view.status).toBe("Expired");
    expect(view.reservedUntil).toBeNull();
  });

  it("checkout releases expired holds before checking stock", async () => {
    const first = await checkout({}, { source: { type: "buy-now", item: { productId: lastOne, size: "Free Size", color: null, quantity: 1 } } });
    expect(first.status).toBe(201);
    await Order.updateOne({ orderNumber: first.body.data.order.id }, { $set: { reservationExpiresAt: new Date(Date.now() - 1000) } });
    const second = await checkout({}, { source: { type: "buy-now", item: { productId: lastOne, size: "Free Size", color: null, quantity: 1 } } });
    expect(second.status).toBe(201);
    expect(await variant("MM-L1-FREE")).toMatchObject({ stock: 1, reserved: 1 });
  });
});

/* ---------- Order access ---------- */

describe("order history and access control", () => {
  it("customers see their own history (paginated) and details; nobody else can", async () => {
    const alice = await signUp("alice@example.com");
    const placedIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      await add(alice, shirt, "40", null, 1);
      const r = await checkout(alice, { customer: { ...CUSTOMER, email: "alice@example.com" } });
      expect(r.status).toBe(201);
      placedIds.push(r.body.data.order.id);
      await new Promise((r) => setTimeout(r, 5));
    }
    const page1 = await json(await ordersRoute(req("/api/v1/orders?page=1&limit=2", { method: "GET", jar: alice }), ctx()));
    expect(page1.data.map((o: { id: string }) => o.id)).toEqual([placedIds[2], placedIds[1]]);
    expect(page1.meta.pagination).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
    const page2 = await json(await ordersRoute(req("/api/v1/orders?page=2&limit=2", { method: "GET", jar: alice }), ctx()));
    expect(page2.data.map((o: { id: string }) => o.id)).toEqual([placedIds[0]]);
    expect((await ordersRoute(req("/api/v1/orders?limit=500", { method: "GET", jar: alice }), ctx())).status).toBe(400);

    expect((await getOrder(placedIds[0], { jar: alice })).status).toBe(200);

    const bob = await signUp("bob@example.com");
    expect((await json(await ordersRoute(req("/api/v1/orders", { method: "GET", jar: bob }), ctx()))).data).toEqual([]);
    expect((await getOrder(placedIds[0], { jar: bob })).status).toBe(404);
    expect((await getOrder(placedIds[0])).status).toBe(404);
    expect((await ordersRoute(req("/api/v1/orders", { method: "GET" }), ctx())).status).toBe(401);
  });

  it("guests read their order only with its access token; order numbers alone reveal nothing", async () => {
    const jar: Jar = {};
    await add(jar, shirt, "40", null, 1);
    const { body } = await checkout(jar);
    const { order, accessToken } = body.data;

    const withToken = await getOrder(order.id, { token: accessToken });
    expect(withToken.status).toBe(200);
    expect((await json(withToken)).data).toMatchObject({ id: order.id, total: 999, status: "Payment Pending" });

    const missing = await json(await getOrder("MMZZZZZZZZ", { token: accessToken }));
    for (const attempt of [
      await getOrder(order.id),
      await getOrder(order.id, { jar }), // the guest cookie alone isn't enough
      await getOrder(order.id, { token: "x".repeat(43) }),
      await getOrder(order.id, { token: accessToken.slice(0, 42) + (accessToken.endsWith("A") ? "B" : "A") }),
    ]) {
      expect(attempt.status).toBe(404);
      expect((await json(attempt)).message).toBe(missing.message); // indistinguishable from a non-existent order
    }

    // A token for one order doesn't open another.
    const other = await checkout({}, { source: { type: "buy-now", item: { productId: shirt, size: "40", color: null, quantity: 1 } } });
    expect((await getOrder(other.body.data.order.id, { token: accessToken })).status).toBe(404);
    expect((await getOrder("not-an-order", { token: accessToken })).status).toBe(400);
  });
});
