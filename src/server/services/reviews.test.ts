import { createHmac, randomBytes } from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { Types } from "mongoose";
import { NextRequest, type NextResponse } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as adminReviewRoute from "@/app/api/v1/admin/reviews/[id]/route";
import * as adminReviewsRoute from "@/app/api/v1/admin/reviews/route";
import { POST as adminLogin } from "@/app/api/v1/admin/auth/login/route";
import { PATCH as orderStatusRoute } from "@/app/api/v1/admin/orders/[id]/status/route";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as addLine } from "@/app/api/v1/cart/items/route";
import { POST as placeRoute } from "@/app/api/v1/checkout/orders/route";
import { POST as confirmRoute } from "@/app/api/v1/orders/[id]/reviews/uploads/confirm/route";
import { POST as signRoute } from "@/app/api/v1/orders/[id]/reviews/uploads/sign/route";
import * as orderReviewsRoute from "@/app/api/v1/orders/[id]/reviews/route";
import { GET as myOrdersRoute } from "@/app/api/v1/orders/route";
import { POST as createPaymentRoute } from "@/app/api/v1/payments/razorpay/create/route";
import { POST as webhookRoute } from "@/app/api/v1/payments/razorpay/webhook/route";
import * as productReviewsRoute from "@/app/api/v1/products/[ref]/reviews/route";
import { ADMIN_NAV } from "@/components/admin/layout/admin-nav";
import { ProductReviews, ReviewList } from "@/components/products/ProductReviews";
import { checkReviewImage, itemReviewView, uploadBlocker } from "@/lib/reviews";
import { hashPassword } from "@/server/auth/password";
import { DEFAULT_ROLE_PERMISSIONS } from "@/server/auth/permissions";
import { resetEnvCache } from "@/server/config/env";
import { connectToDatabase, disconnectFromDatabase } from "@/server/db/connect";
import { signParams } from "@/server/integrations/cloudinary/client";
import * as models from "@/server/models";
import { Admin, AuditLog, Category, MediaAsset, Order, Payment, Product, Review, Role, User } from "@/server/models";
import { resetRateLimits } from "@/server/security/rate-limit";
import { getProductDetail, listProducts, loadCatalogSnapshot } from "@/server/services/catalog.service";
import { cleanupOrphanImages } from "@/server/services/media.service";
import { displayName } from "@/server/services/review.service";
import type { StoreOrderStatus } from "@/types";

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }));

/**
 * Verified-purchase reviews written from a delivered order, with photos — through the real API
 * routes against a throwaway in-memory replica set. Razorpay and Cloudinary are faked: nothing
 * leaves the machine, and no real payment, refund or image calls are made.
 */

const ORIGIN = "http://localhost:3000";
const PW = "Correct-horse-42";
const WEBHOOK_SECRET = "review-webhook-secret";
const CLOUD_SECRET = "cloud-secret-never-shown";
const PRICE = 129900;
const MB = 1024 * 1024;
const COMMENT = "Soft fabric and the fit is just right.";

type Jar = Record<string, string>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>;
type As = "owner" | "manager" | "staff";
const admins = {} as Record<As, Jar>;
const rid = (p: string) => `${p}_${randomBytes(7).toString("hex")}`;
let rs: MongoMemoryReplSet;
let categoryId: Types.ObjectId;
const product = {} as Record<"a" | "b", { _id: Types.ObjectId; id: string; slug: string; sku: string; name: string }>;
let seq = 0;

/* ---------- Fake Cloudinary (and Razorpay order creation) ---------- */

const cloud = {
  files: new Map<string, Rec>(),
  copies: [] as Rec[],
  destroyed: [] as string[],
  fail: null as null | "copy" | "destroy" | "lookup",
  reset() {
    this.files.clear();
    this.copies = [];
    this.destroyed = [];
    this.fail = null;
  },
  /** What Cloudinary holds after the browser posts a file with our signed fields. */
  put(publicId: string, file: { format?: string; bytes?: number; resource_type?: string } = {}) {
    const format = file.format ?? "jpg";
    this.files.set(publicId, { public_id: publicId, format, bytes: file.bytes ?? 200_000, width: 1200, height: 1500, resource_type: file.resource_type ?? "image", type: "upload", secure_url: `https://res.cloudinary.com/testcloud/image/upload/v1/${publicId}.${format}` });
  },
};

const fetchSpy = vi.fn(async (input: unknown, init: RequestInit = {}) => {
  const url = String(input);
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  if (url === "https://api.razorpay.com/v1/orders" && init.method === "POST") {
    const body = JSON.parse(String(init.body));
    return json({ id: rid("order"), amount: body.amount, currency: body.currency, receipt: body.receipt, status: "created" });
  }
  const api = "https://api.cloudinary.com/v1_1/testcloud";
  if (url.startsWith(`${api}/resources/image/upload/`)) {
    if (cloud.fail === "lookup") return json({ error: { message: "down" } }, 500);
    const file = cloud.files.get(decodeURIComponent(url.slice(`${api}/resources/image/upload/`.length)));
    return file ? json(file) : json({ error: { message: "missing" } }, 404);
  }
  if (url === `${api}/image/upload` || url === `${api}/image/destroy`) {
    const { signature, api_key, file, ...signed } = Object.fromEntries(new URLSearchParams(String(init.body)));
    if (!api_key || signature !== signParams(signed, CLOUD_SECRET)) return json({ error: { message: "bad signature" } }, 401);
    if (url.endsWith("/destroy")) {
      if (cloud.fail === "destroy") return json({ error: { message: "down" } }, 500);
      cloud.destroyed.push(signed.public_id);
      return json({ result: cloud.files.delete(signed.public_id) ? "ok" : "not found" });
    }
    if (cloud.fail === "copy") return json({ error: { message: "down" } }, 500);
    const source = [...cloud.files.values()].find((f) => f.secure_url === file);
    if (!source) return json({ error: { message: "no source" } }, 400);
    cloud.copies.push({ ...signed, source: source.public_id });
    cloud.put(signed.public_id, { format: source.format, bytes: Math.min(source.bytes, 150_000) });
    return json(cloud.files.get(signed.public_id));
  }
  throw new Error(`Unexpected network call: ${url}`);
});

/* ---------- Harness ---------- */

function req(path: string, init: { method?: string; body?: unknown; raw?: string; jar?: Jar | null; origin?: string; headers?: Record<string, string> } = {}) {
  seq += 1;
  const headers: Record<string, string> = { origin: init.origin ?? ORIGIN, "x-forwarded-for": `10.7.${Math.floor(seq / 250) % 250}.${seq % 250}`, ...init.headers };
  if (init.body !== undefined || init.raw !== undefined) headers["content-type"] = "application/json";
  if (init.jar && Object.keys(init.jar).length) headers.cookie = Object.entries(init.jar).map(([k, v]) => `${k}=${v}`).join("; ");
  return new NextRequest(`${ORIGIN}${path}`, { method: init.method ?? "GET", headers, body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)) });
}
const ctx = <P extends Record<string, string>>(params: P = {} as P) => ({ params: Promise.resolve(params) });
const cookiesOf = (res: Response): Jar => Object.fromEntries((res as NextResponse).cookies.getAll().filter((c) => c.value).map((c) => [c.name, c.value]));
type Body = { success: boolean; message: string; data: Rec; error?: { code: string } };
const call = async (res: Response | Promise<Response>) => {
  const r = await res;
  return { status: r.status, body: (await r.clone().json()) as Body };
};

type OrderRef = { orderNumber: string };
const post = (route: (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>, id: string, path: string, body: unknown, jar: Jar | null, origin?: string) =>
  call(route(req(`/api/v1/orders/${id}${path}`, { method: "POST", body, jar, origin }), ctx({ id })));
const submit = (order: OrderRef, jar: Jar | null, body: Rec = {}, origin?: string) =>
  post(orderReviewsRoute.POST, order.orderNumber, "/reviews", { productId: product.a.id, rating: 5, comment: COMMENT, ...body }, jar, origin);
const states = (order: OrderRef, jar: Jar | null) => call(orderReviewsRoute.GET(req(`/api/v1/orders/${order.orderNumber}/reviews`, { jar }), ctx({ id: order.orderNumber })));
const stateOf = async (order: OrderRef, jar: Jar, key: "a" | "b" = "a") => ((await states(order, jar)).body.data as unknown as Rec[]).find((e) => e.productId === product[key].id)?.status;
const sign = (order: OrderRef, jar: Jar | null, body: Rec = {}, origin?: string) =>
  post(signRoute, order.orderNumber, "/reviews/uploads/sign", { productId: product.a.id, contentType: "image/jpeg", size: 200_000, ...body }, jar, origin);
const confirm = (order: OrderRef, jar: Jar | null, uploadId: string, productId = product.a.id) =>
  post(confirmRoute, order.orderNumber, "/reviews/uploads/confirm", { productId, uploadId }, jar);

/** The whole browser flow: sign, upload to (fake) Cloudinary, confirm. Returns the image. */
async function addPhoto(order: OrderRef, jar: Jar, file: Parameters<typeof cloud.put>[1] = {}, key: "a" | "b" = "a") {
  const signed = await sign(order, jar, { productId: product[key].id });
  expect(signed.status, signed.body.message).toBe(200);
  cloud.put(signed.body.data.fields.public_id, file);
  const done = await confirm(order, jar, signed.body.data.uploadId, product[key].id);
  expect(done.status, done.body.message).toBe(200);
  return done.body.data as { id: string; url: string };
}

const publicList = async (ref: string, page = 1) => (await call(productReviewsRoute.GET(req(`/api/v1/products/${ref}/reviews?page=${page}`), ctx({ ref })))).body.data;
const adminList = (jar: Jar | null, query = "") => call(adminReviewsRoute.GET(req(`/api/v1/admin/reviews${query}`, { jar }), ctx()));
const adminDelete = (id: string, jar: Jar | null, origin?: string) => call(adminReviewRoute.DELETE(req(`/api/v1/admin/reviews/${id}`, { method: "DELETE", jar, origin }), ctx({ id })));
const stats = async (key: "a" | "b") => {
  const p = await Product.findById(product[key]._id).lean();
  return { average: p!.reviewStats?.average ?? 0, count: p!.reviewStats?.count ?? 0 };
};

async function customer(fullName = "Asha Menon") {
  const n = ++seq;
  const email = `buyer${n}@example.com`;
  const res = await register(req("/api/v1/auth/register", { method: "POST", body: { fullName, email, mobile: `98${String(10000000 + n)}`, password: "Kerala2026" } }), ctx());
  expect(res.status).toBe(201);
  return { id: (await User.findOne({ email }).lean())!._id, email, jar: cookiesOf(res) };
}

const line = (key: "a" | "b") => {
  const p = product[key];
  return { product: p._id, variantSku: p.sku, name: p.name, slug: p.slug, category: categoryId, size: "M", color: "Rose", unitPricePaise: PRICE, mrpPaise: PRICE, quantity: 1, lineTotalPaise: PRICE };
};

/** A delivered, paid order and its payment record, shaped as the app leaves them. */
async function purchase(userId: Types.ObjectId | null, keys: ("a" | "b")[] = ["a"], over: { order?: Rec; payment?: Rec | null } = {}) {
  const n = ++seq;
  const total = PRICE * keys.length;
  const paymentId = rid("pay");
  const order = await Order.create({
    orderNumber: `MMREV${String(n).padStart(5, "0")}`,
    user: userId,
    customer: { fullName: "Asha Menon", email: "asha@example.com", mobile: "9876543210" },
    shippingAddress: { house: "1 Test House", street: "MG Road", city: "Kochi", district: "Ernakulam", state: "Kerala", pincode: "682001", country: "India" },
    items: keys.map(line),
    subtotalPaise: total,
    mrpTotalPaise: total,
    discountPaise: 0,
    totalPaise: total,
    paymentMethod: "upi",
    status: "delivered",
    paymentStatus: "captured",
    razorpayPaymentId: paymentId,
    statusHistory: [{ status: "placed", at: new Date() }],
    ...over.order,
  });
  if (over.payment !== null) {
    await Payment.create({ order: order._id, orderNumber: order.orderNumber, attempt: 1, user: userId, mode: "test", razorpayOrderId: rid("order"), razorpayPaymentId: order.razorpayPaymentId ?? paymentId, amountPaise: total, status: "captured", ...over.payment });
  }
  return order;
}

async function buyer(name?: string, keys: ("a" | "b")[] = ["a"], over: Parameters<typeof purchase>[2] = {}) {
  const c = await customer(name);
  const order = await purchase(c.id, keys, over);
  return { ...c, order };
}

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  vi.stubEnv("MONGODB_URI", rs.getUri());
  vi.stubEnv("MONGODB_DB_NAME", "mm-review-test");
  vi.stubEnv("JWT_ACCESS_SECRET", "a".repeat(48));
  vi.stubEnv("JWT_REFRESH_SECRET", "r".repeat(48));
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_ReviewTests1");
  vi.stubEnv("RAZORPAY_KEY_SECRET", "review-key-secret");
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", WEBHOOK_SECRET);
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
    const res = await adminLogin(req("/api/v1/admin/auth/login", { method: "POST", body: { identifier: `${key}@t.in`, password: PW } }), ctx());
    expect(res.status).toBe(200);
    admins[key] = cookiesOf(res);
  }
  categoryId = (await Category.create({ slug: "kurtis", audience: "women", name: "Kurtis" }))._id;
}, 240_000);

beforeEach(async () => {
  await Promise.all([Order.deleteMany({}), Payment.deleteMany({}), Review.deleteMany({}), Product.deleteMany({}), User.deleteMany({}), AuditLog.deleteMany({}), MediaAsset.deleteMany({}), models.Cart.deleteMany({}), models.WebhookEvent.deleteMany({}), models.InventoryMovement.deleteMany({})]);
  for (const key of ["a", "b"] as const) {
    const slug = `product-${key}`;
    const sku = `MM-${key.toUpperCase()}-M-ROSE`;
    const name = `Product ${key.toUpperCase()}`;
    const doc = await Product.create({
      slug, name, sku: `MM-${key.toUpperCase()}`, audience: "women", category: categoryId, status: "active", pricePaise: 0, mrpPaise: 0,
      // Sample figures, as the catalogue import left them: they must never be shown.
      rating: { average: 4.8, count: 154 },
      variants: [{ sku, size: "M", color: { name: "Rose" }, pricePaise: PRICE, mrpPaise: PRICE, stock: 10 }],
    });
    product[key] = { _id: doc._id, id: String(doc._id), slug, sku, name };
  }
  resetRateLimits();
  cloud.reset();
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("CLOUDINARY_CLOUD_NAME", "testcloud");
  vi.stubEnv("CLOUDINARY_API_KEY", "123456789012345");
  vi.stubEnv("CLOUDINARY_API_SECRET", CLOUD_SECRET);
  resetEnvCache();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await disconnectFromDatabase();
  await rs?.stop();
  vi.unstubAllEnvs();
  resetEnvCache();
});

/* ---------- The product page ---------- */

describe("product page", () => {
  const review = { id: "r1", authorName: "Asha M.", rating: 4, title: "", comment: COMMENT, createdAt: "2026-11-01T00:00:00.000Z", images: [] };

  it("has no review form or submission control", () => {
    const html = renderToStaticMarkup(createElement(ProductReviews, { product: { slug: "product-a", rating: 4.5, reviewCount: 2 } as never }));
    expect(html).toContain("Ratings &amp; reviews");
    expect(html).toContain("Based on 2 reviews");
    expect(html).toContain('href="/account/orders"');
    for (const control of ["<form", "<textarea", "<input", "Write a review", "Write Review", "Submit review", "Log in to review"]) expect(html).not.toContain(control);
  });

  it("still shows existing reviews, with their stars, text and photos", () => {
    const withPhoto = { ...review, id: "r2", comment: "Second review, with a photo.", images: [{ url: "https://res.cloudinary.com/testcloud/image/upload/v1/mm-collections/reviews/abc.jpg", width: 800, height: 800 }] };
    const html = renderToStaticMarkup(createElement(ReviewList, { items: [review, withPhoto] }));
    for (const shown of [COMMENT, "Second review, with a photo.", "Asha M.", "Verified buyer", "Rated 4.0 out of 5", "mm-collections/reviews/abc.jpg"]) expect(html).toContain(shown);
    expect(html.match(/<img[^>]+Photo 1 from/g)).toHaveLength(1);
  });

  it("offers no way to submit through the product API", () => {
    expect(Object.keys(productReviewsRoute).filter((k) => /^[A-Z]+$/.test(k))).toEqual(["GET"]);
  });
});

/* ---------- Eligibility ---------- */

describe("through real checkout, payment, delivery and refund", () => {
  const webhook = (body: unknown) => {
    const raw = JSON.stringify(body);
    return call(webhookRoute(req("/api/v1/payments/razorpay/webhook", { method: "POST", raw, headers: { "x-razorpay-signature": createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex"), "x-razorpay-event-id": rid("evt") } }), ctx()));
  };

  it("opens only when the paid order is marked Delivered, and closes on a full refund", async () => {
    const c = await customer();
    const jar = { ...c.jar };
    Object.assign(jar, cookiesOf(await addLine(req("/api/v1/cart/items", { method: "POST", body: { productId: product.a.id, size: "M", color: "Rose", quantity: 1 }, jar }), ctx())));
    const placed = await call(
      placeRoute(
        req("/api/v1/checkout/orders", {
          method: "POST",
          jar,
          body: {
            source: { type: "cart" },
            customer: { fullName: "Asha Menon", email: c.email, mobile: "9876543210" },
            address: { house: "1 Test House", street: "MG Road", city: "Kochi", district: "Ernakulam", state: "Kerala", pincode: "682001" },
            paymentMethod: "upi",
            idempotencyKey: `review-${Date.now()}-abcdefgh`,
            expectedTotalPaise: PRICE,
          },
        }),
        ctx(),
      ),
    );
    expect(placed.status, placed.body.message).toBe(201);
    const order = { orderNumber: placed.body.data.order.id as string };
    const started = await call(createPaymentRoute(req("/api/v1/payments/razorpay/create", { method: "POST", body: { orderId: order.orderNumber }, jar }), ctx()));
    expect(started.status, started.body.message).toBe(200);

    const refusedNow = async (message: RegExp) => {
      const r = await submit(order, jar);
      expect(r.status).toBe(403);
      expect(r.body.message).toMatch(message);
      expect((await sign(order, jar)).status).toBe(403);
    };
    await refusedNow(/after delivery/); // unpaid

    const payment = { id: rid("pay"), order_id: started.body.data.razorpayOrderId, amount: PRICE, currency: "INR", status: "captured", method: "upi", international: false, captured: true, fee: 0, tax: 0 };
    expect((await webhook({ event: "payment.captured", payload: { payment: { entity: payment } } })).status).toBe(200);
    for (const next of ["Confirmed", "Processing", "Packed", "Shipped", "Out for Delivery"]) {
      const moved = await call(orderStatusRoute(req(`/api/v1/admin/orders/${order.orderNumber}/status`, { method: "PATCH", body: { status: next }, jar: admins.owner }), ctx({ id: order.orderNumber })));
      expect([next, moved.status]).toEqual([next, 200]);
      resetRateLimits();
      expect([next, await stateOf(order, jar)]).toEqual([next, "awaiting_delivery"]);
      await refusedNow(/after delivery/);
    }
    expect((await call(orderStatusRoute(req(`/api/v1/admin/orders/${order.orderNumber}/status`, { method: "PATCH", body: { status: "Delivered" }, jar: admins.owner }), ctx({ id: order.orderNumber })))).status).toBe(200);
    expect(await stateOf(order, jar)).toBe("eligible");

    const refund = { id: rid("rfnd"), payment_id: payment.id, amount: PRICE, currency: "INR", status: "processed" };
    expect((await webhook({ event: "refund.processed", payload: { refund: { entity: refund } } })).status).toBe(200);
    expect((await Order.findOne({ orderNumber: order.orderNumber }).lean())!.paymentStatus).toBe("refunded");
    expect(await stateOf(order, jar)).toBe("unavailable");
    await refusedNow(/isn't eligible/);
    expect(await Review.countDocuments()).toBe(0);
    expect(await MediaAsset.countDocuments()).toBe(0);
  });
});

describe("who can submit", () => {
  it("lets the owner of a delivered order publish a verified review", async () => {
    const c = await buyer();
    expect(await stateOf(c.order, c.jar)).toBe("eligible");
    const r = await submit(c.order, c.jar, { rating: 4, comment: `  ${COMMENT}  ` });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ authorName: "Asha M.", rating: 4, comment: COMMENT, images: [] });
    const stored = (await Review.findOne().lean())!;
    expect([String(stored.user), String(stored.product), String(stored.order), stored.variantSku]).toEqual([String(c.id), product.a.id, String(c.order._id), product.a.sku]);
    expect(stored.verifiedAt).toBeInstanceOf(Date);
    expect(String(stored.payment)).toBe(String((await Payment.findOne({ order: c.order._id }).lean())!._id));
    expect(await stats("a")).toEqual({ average: 4, count: 1 });
  });

  it("decides each product of an order separately, only for products in it", async () => {
    const c = await buyer("Asha Menon", ["a", "b", "a"]);
    expect((await states(c.order, c.jar)).body.data).toEqual([
      { productId: product.a.id, status: "eligible", review: null },
      { productId: product.b.id, status: "eligible", review: null },
    ]);
    expect((await submit(c.order, c.jar)).status).toBe(201);
    expect([await stateOf(c.order, c.jar, "a"), await stateOf(c.order, c.jar, "b")]).toEqual(["reviewed", "eligible"]);

    const onlyA = await buyer("Bala Nair", ["a"]);
    const r = await submit(onlyA.order, onlyA.jar, { productId: product.b.id });
    expect(r.status).toBe(403);
    expect(r.body.message).toBe("That product isn't part of this order.");
    expect((await sign(onlyA.order, onlyA.jar, { productId: product.b.id })).status).toBe(403);
    expect((await submit(onlyA.order, onlyA.jar, { productId: String(new Types.ObjectId()) })).status).toBe(403);
    expect(await stats("b")).toEqual({ average: 0, count: 0 });
  });

  it("can't use another customer's order or a guest order, even with the same email", async () => {
    const victim = await buyer();
    const other = await customer();
    const guestOrder = await purchase(null, ["a"], { order: { customer: { fullName: "Guest", email: other.email, mobile: "9876543210" } } });
    for (const order of [victim.order, guestOrder, { orderNumber: "MMNOSUCH01" }]) {
      for (const r of [await submit(order, other.jar), await states(order, other.jar), await sign(order, other.jar)]) {
        expect([order.orderNumber, r.status, r.body.message]).toEqual([order.orderNumber, 404, "Order not found."]);
      }
    }
    expect(await Review.countDocuments()).toBe(0);
  });

  it("refuses guests, signed-out and admin sessions, blocked accounts and cross-site requests", async () => {
    const c = await buyer();
    for (const jar of [null, admins.owner, { mm_access: "forged.token.value" }]) {
      expect((await submit(c.order, jar)).status).toBe(401);
      expect((await states(c.order, jar)).status).toBe(401);
      expect((await sign(c.order, jar)).status).toBe(401);
      expect((await confirm(c.order, jar, String(new Types.ObjectId()))).status).toBe(401);
    }
    expect((await submit(c.order, c.jar, {}, "https://evil.example")).status).toBe(403);
    expect((await sign(c.order, c.jar, {}, "https://evil.example")).status).toBe(403);
    await User.updateOne({ _id: c.id }, { status: "blocked" });
    expect((await submit(c.order, c.jar)).status).toBe(403);
    expect(await Review.countDocuments()).toBe(0);
  });

  it("ignores identity, delivery, verification and image-URL claims sent by the browser", async () => {
    const victim = await buyer();
    const early = await buyer("Mallory K", ["a"], { order: { status: "shipped" } });
    const claims = { user: String(victim.id), userId: String(victim.id), orderId: victim.order.orderNumber, order: String(victim.order._id), status: "delivered", delivered: true, purchased: true, verified: true, verifiedAt: "2020-01-01" };
    expect((await submit(early.order, early.jar, claims)).status).toBe(403);

    const r = await submit(victim.order, victim.jar, { ...claims, user: String(early.id), product: product.b.id, authorName: "Store Owner", title: "Official", createdAt: "2001-01-01", images: [{ url: "https://evil.example/x.jpg", publicId: "mm-collections/reviews/x" }], imageUrls: ["https://evil.example/y.jpg"] });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ authorName: "Asha M.", title: "", images: [] });
    const stored = (await Review.findOne().lean())!;
    expect([String(stored.user), String(stored.product)]).toEqual([String(victim.id), product.a.id]);
    expect(stored.verifiedAt!.getFullYear()).toBeGreaterThan(2020);
  });

  const beforeDelivery = ["placed", "confirmed", "processing", "packed", "shipped", "out_for_delivery"];
  it.each(beforeDelivery)("refuses a direct API call while the order is %s", async (status) => {
    const c = await buyer("Asha Menon", ["a"], { order: { status } });
    expect(await stateOf(c.order, c.jar)).toBe("awaiting_delivery");
    const r = await submit(c.order, c.jar);
    expect([r.status, r.body.message]).toEqual([403, "You can review this product after delivery."]);
    expect((await sign(c.order, c.jar)).status).toBe(403);
    expect(await Review.countDocuments()).toBe(0);
  });

  const refused: [string, Parameters<typeof purchase>[2]][] = [
    ["a cancelled order", { order: { status: "cancelled" } }],
    ["a cancelled and refunded order", { order: { status: "cancelled", paymentStatus: "refunded" } }],
    ["an unpaid order", { order: { status: "pending_payment", paymentStatus: "pending", razorpayPaymentId: null }, payment: null }],
    ["a failed payment", { order: { status: "payment_failed", paymentStatus: "failed" } }],
    ["an expired order that was paid late", { order: { status: "expired" } }],
    ["a delivered order that was never paid", { order: { paymentStatus: "pending", razorpayPaymentId: null }, payment: null }],
    ["a delivered order with an uncaptured payment", { order: { paymentStatus: "authorized" } }],
    ["a delivered order that was fully refunded", { order: { paymentStatus: "refunded", refundedPaise: PRICE }, payment: { status: "refunded" } }],
    ["a delivered order refunded up to its total", { order: { paymentStatus: "partially_refunded", refundedPaise: PRICE } }],
    ["a delivered order with no payment record", { payment: null }],
    ["a delivered order whose payment record isn't captured", { payment: { status: "created" } }],
    ["a delivered order without a gateway payment ID", { order: { razorpayPaymentId: null } }],
    ["a payment record for a different payment", { payment: { razorpayPaymentId: "pay_someoneelse01" } }],
  ];
  it.each(refused)("refuses %s", async (_label, over) => {
    const c = await buyer("Asha Menon", ["a"], over);
    expect(await stateOf(c.order, c.jar)).not.toBe("eligible");
    expect((await submit(c.order, c.jar)).status).toBe(403);
    expect((await sign(c.order, c.jar)).status).toBe(403);
    expect(await Review.countDocuments()).toBe(0);
  });

  it("accepts a partially refunded delivered order, and a product since taken off sale", async () => {
    const c = await buyer("Asha Menon", ["a"], { order: { paymentStatus: "partially_refunded", refundedPaise: 100 }, payment: { status: "partially_refunded" } });
    await Product.updateOne({ _id: product.a._id }, { status: "archived" });
    expect((await submit(c.order, c.jar)).status).toBe(201);
  });

  it("validates the rating and text", async () => {
    const c = await buyer();
    for (const body of [{ rating: undefined }, { comment: undefined }, { rating: 0 }, { rating: 6 }, { rating: 4.5 }, { rating: "5" }, { comment: "short" }, { comment: "          " }, { comment: "x".repeat(2001) }, { comment: { $ne: null } }, { productId: "product-a" }, { productId: { $ne: null } }]) {
      resetRateLimits();
      expect([body, (await submit(c.order, c.jar, body)).status]).toEqual([body, 400]);
    }
    expect(await Review.countDocuments()).toBe(0);
  });

  it("rate limits repeated submissions per customer", async () => {
    const c = await buyer("Asha Menon", ["a"], { order: { status: "shipped" } });
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await submit(c.order, c.jar)).status);
    expect(statuses).toEqual([...Array(10).fill(403), 429]);
  });
});

describe("one review per customer per product", () => {
  it("refuses a second review, from this order or another", async () => {
    const c = await buyer();
    const second = await purchase(c.id);
    expect((await submit(c.order, c.jar)).status).toBe(201);
    for (const order of [c.order, second]) {
      expect((await submit(order, c.jar, { rating: 1, comment: "Trying to add another one." })).status).toBe(409);
      expect((await sign(order, c.jar)).status).toBe(409);
      expect((await states(order, c.jar)).body.data).toMatchObject([{ status: "reviewed", review: { rating: 5, comment: COMMENT } }]);
    }
    expect(await Review.countDocuments()).toBe(1);
    expect(await stats("a")).toEqual({ average: 5, count: 1 });
  });

  it("simultaneous submissions create exactly one, even without the secondary indexes", async () => {
    await Review.collection.dropIndexes();
    try {
      const c = await buyer();
      const photo = await addPhoto(c.order, c.jar);
      const results = await Promise.all(Array.from({ length: 5 }, () => submit(c.order, c.jar, { imageIds: [photo.id] })));
      expect(results.map((r) => r.status).filter((s) => s === 201)).toHaveLength(1);
      expect(results.every((r) => [201, 400, 409].includes(r.status))).toBe(true);
      expect(await Review.countDocuments()).toBe(1);
      expect(await stats("a")).toEqual({ average: 5, count: 1 });
    } finally {
      await Review.syncIndexes();
    }
  });

  it("keeps the rating right when several customers review at once", async () => {
    const buyers = [];
    for (let i = 0; i < 5; i++) buyers.push(await buyer());
    const results = await Promise.all(buyers.map((b, i) => submit(b.order, b.jar, { rating: i + 1 })));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(await stats("a")).toEqual({ average: 3, count: 5 });
  });
});

/* ---------- Photos ---------- */

describe("photo uploads", () => {
  it("signs a one-time upload to a random ID, without the secret or anything about the customer", async () => {
    const c = await buyer();
    const r = await sign(c.order, c.jar);
    expect(r.status).toBe(200);
    expect(r.body.data.uploadUrl).toBe("https://api.cloudinary.com/v1_1/testcloud/image/upload");
    const { signature, api_key, ...signed } = r.body.data.fields;
    expect(Object.keys(signed).sort()).toEqual(["allowed_formats", "overwrite", "public_id", "timestamp"]);
    expect(signed).toMatchObject({ allowed_formats: "jpg,png,webp", overwrite: "false" });
    expect(signed.public_id).toMatch(/^mm-collections\/review-uploads\/[a-z0-9]+-[a-f0-9]{24}$/);
    expect(signature).toBe(signParams(signed, CLOUD_SECRET));
    expect(api_key).toBe("123456789012345");
    expect(JSON.stringify(r.body)).not.toContain(CLOUD_SECRET);
  });

  it("accepts JPG, PNG and WebP, and saves them with the rating and text in the chosen order", async () => {
    const c = await buyer();
    const photos = [];
    for (const format of ["jpg", "png", "webp"]) photos.push(await addPhoto(c.order, c.jar, { format, bytes: 5 * MB }));
    for (const contentType of ["image/jpeg", "image/png", "image/webp"]) expect((await sign(c.order, c.jar, { contentType, size: 5 * MB })).status).toBe(200);
    const order = [photos[2], photos[0], photos[1]];
    const r = await submit(c.order, c.jar, { rating: 3, imageIds: order.map((p) => p.id) });
    expect(r.status, r.body.message).toBe(201);
    expect(r.body.data).toMatchObject({ rating: 3, comment: COMMENT });
    expect(r.body.data.images.map((i: Rec) => i.url)).toEqual(order.map((p) => p.url));
    const stored = (await Review.findOne().lean())!;
    expect(stored.images.map((i) => [i.url, i.publicId.startsWith("mm-collections/reviews/")])).toEqual(order.map((p) => [p.url, true]));
    expect((await MediaAsset.find({ status: "attached" }).lean()).length).toBe(3);
  });

  it("publishes only the server's own metadata-free copy, and deletes the uploaded original", async () => {
    const c = await buyer();
    const photo = await addPhoto(c.order, c.jar);
    const [copy] = cloud.copies;
    expect(copy).toMatchObject({ transformation: "c_limit,fl_force_strip,h_2000,w_2000", overwrite: "false" });
    expect(photo.url).toContain(`/${copy.public_id}.`);
    expect(copy.public_id).not.toBe(copy.source);
    expect(cloud.destroyed).toEqual([copy.source]);
    expect([...cloud.files.keys()]).toEqual([copy.public_id]);
    expect(photo.url).not.toMatch(new RegExp(`${c.id}|${c.order.orderNumber}|asha`, "i"));
  });

  it("rejects declared files over 5 MB or of another type before signing", async () => {
    const c = await buyer();
    for (const body of [{ size: 5 * MB + 1 }, { size: 0 }, { contentType: "image/gif" }, { contentType: "image/heic" }, { contentType: "image/svg+xml" }, { contentType: "image/avif" }, { contentType: "application/pdf" }]) {
      expect([body, (await sign(c.order, c.jar, body)).status]).toEqual([body, 400]);
    }
    expect(await MediaAsset.countDocuments()).toBe(0);
  });

  it("checks Cloudinary's own record, so a lying browser gets its file deleted", async () => {
    const c = await buyer();
    for (const [file, message] of [
      [{ bytes: 5 * MB + 1 }, /5 MB or smaller/],
      [{ format: "gif" }, /JPG, PNG or WebP/],
      [{ format: "svg" }, /JPG, PNG or WebP/],
      [{ format: "pdf" }, /JPG, PNG or WebP/],
      [{ resource_type: "raw" }, /JPG, PNG or WebP/],
    ] as const) {
      const signed = (await sign(c.order, c.jar)).body.data;
      cloud.put(signed.fields.public_id, file);
      const r = await confirm(c.order, c.jar, signed.uploadId);
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(message);
      expect(cloud.files.has(signed.fields.public_id)).toBe(false);
      expect((await submit(c.order, c.jar, { imageIds: [signed.uploadId] })).status).toBe(400);
    }
    expect(cloud.copies).toEqual([]);
    expect(await Review.countDocuments()).toBe(0);
  });

  it("allows at most 3 photos, each once", async () => {
    const c = await buyer();
    const photos = [];
    for (let i = 0; i < 4; i++) photos.push((await addPhoto(c.order, c.jar)).id);
    const four = await submit(c.order, c.jar, { imageIds: photos });
    expect(four.status).toBe(400);
    expect(JSON.stringify(four.body)).toContain("up to 3 photos");
    expect((await submit(c.order, c.jar, { imageIds: [photos[0], photos[0]] })).status).toBe(400);
    expect((await submit(c.order, c.jar, { imageIds: photos.slice(0, 3) })).status).toBe(201);
  });

  it("a photo that failed to upload stops the review from being saved", async () => {
    const c = await buyer();
    const good = await addPhoto(c.order, c.jar);
    const signed = (await sign(c.order, c.jar)).body.data;
    const missing = await confirm(c.order, c.jar, signed.uploadId); // the browser never got the file to Cloudinary
    expect([missing.status, missing.body.message]).toEqual([400, "The photo didn't finish uploading. Please try again."]);
    for (const imageIds of [[signed.uploadId], [good.id, signed.uploadId], [good.id, String(new Types.ObjectId())], ["https://res.cloudinary.com/testcloud/image/upload/v1/x.jpg"]]) {
      expect((await submit(c.order, c.jar, { imageIds })).status).toBe(400);
    }
    expect(await Review.countDocuments()).toBe(0);
    expect((await MediaAsset.findById(good.id).lean())!.status).toBe("uploaded");
  });

  it("can retry a confirmation after the image service fails", async () => {
    const c = await buyer();
    const signed = (await sign(c.order, c.jar)).body.data;
    cloud.put(signed.fields.public_id);
    for (const fail of ["lookup", "copy"] as const) {
      cloud.fail = fail;
      expect((await confirm(c.order, c.jar, signed.uploadId)).status).toBe(502);
    }
    cloud.fail = null;
    expect((await confirm(c.order, c.jar, signed.uploadId)).status).toBe(200);
  });

  it("turns one upload into at most one photo", async () => {
    const c = await buyer();
    const signed = (await sign(c.order, c.jar)).body.data;
    cloud.put(signed.fields.public_id);
    const results = await Promise.all(Array.from({ length: 4 }, () => confirm(c.order, c.jar, signed.uploadId)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 400, 400, 400]);
    expect(cloud.copies).toHaveLength(1);
    // Even if the signature is reused to upload again, it can't be confirmed again.
    cloud.put(signed.fields.public_id);
    expect((await confirm(c.order, c.jar, signed.uploadId)).status).toBe(400);
  });

  it("only attaches the customer's own, unused, recent photos for that product", async () => {
    const asha = await buyer("Asha Menon", ["a", "b"]);
    const bala = await buyer("Bala Nair", ["a"]);
    const theirs = await addPhoto(bala.order, bala.jar);
    const forB = await addPhoto(asha.order, asha.jar, {}, "b");
    const stale = await addPhoto(asha.order, asha.jar);
    await MediaAsset.collection.updateOne({ _id: new Types.ObjectId(stale.id) }, { $set: { createdAt: new Date(Date.now() - 13 * 3600_000) } });
    const adminImage = await MediaAsset.create({ publicId: "mm-collections/products/x/y", purpose: "product", status: "uploaded", url: "https://res.cloudinary.com/testcloud/image/upload/v1/y.jpg" });
    for (const imageId of [theirs.id, forB.id, stale.id, String(adminImage._id)]) {
      resetRateLimits();
      expect([imageId, (await submit(asha.order, asha.jar, { imageIds: [imageId] })).status]).toEqual([imageId, 400]);
    }
    // Someone else's upload can't be confirmed either.
    const signed = (await sign(bala.order, bala.jar)).body.data;
    cloud.put(signed.fields.public_id);
    expect((await confirm(asha.order, asha.jar, signed.uploadId)).status).toBe(400);
    // Once used, a photo can't be used again.
    expect((await submit(asha.order, asha.jar, { productId: product.b.id, imageIds: [forB.id] })).status).toBe(201);
    expect((await submit(asha.order, asha.jar, { imageIds: [forB.id] })).status).toBe(400);
    expect(await Review.countDocuments()).toBe(1);
  });

  it("limits uploads per product per day", async () => {
    const c = await buyer("Asha Menon", ["a", "b"]);
    const statuses = [];
    for (let i = 0; i < 13; i++) statuses.push((await sign(c.order, c.jar)).status);
    expect(statuses).toEqual([...Array(12).fill(200), 429]);
    expect((await sign(c.order, c.jar, { productId: product.b.id })).status).toBe(200);
  });

  it("without Cloudinary configured, photos are unavailable but text reviews still work", async () => {
    vi.stubEnv("CLOUDINARY_API_SECRET", "");
    resetEnvCache();
    const c = await buyer();
    expect((await sign(c.order, c.jar)).status).toBe(503);
    expect((await submit(c.order, c.jar)).status).toBe(201);
  });
});

/* ---------- Public view and ratings ---------- */

describe("public reviews and ratings", () => {
  it("shows no ratings until a verified review exists — never the sample figures", async () => {
    const snapshot = await loadCatalogSnapshot();
    expect(snapshot.products.map((p) => [p.rating, p.reviewCount])).toEqual([[0, 0], [0, 0]]);
    expect((await getProductDetail("product-a")).product).toMatchObject({ rating: 0, reviewCount: 0 });
    expect(await publicList("product-a")).toEqual({ average: 0, count: 0, distribution: [0, 0, 0, 0, 0], items: [], page: 1, totalPages: 1 });
    expect((await Product.findById(product.a._id).lean())!.rating).toMatchObject({ average: 4.8, count: 154 });
  });

  it("shows uploaded photos publicly and to staff, with no account or storage details", async () => {
    const c = await buyer();
    const photo = await addPhoto(c.order, c.jar);
    await submit(c.order, c.jar, { imageIds: [photo.id] });
    const [item] = (await publicList("product-a")).items;
    expect(item.images).toEqual([{ url: photo.url, width: 1200, height: 1500 }]);
    expect(Object.keys(item).sort()).toEqual(["authorName", "comment", "createdAt", "id", "images", "rating", "title"]);
    for (const secret of [String(c.id), c.email, c.order.orderNumber, "publicId"]) expect(JSON.stringify(item)).not.toContain(secret);
    for (const as of ["owner", "manager"] as const) {
      expect((await adminList(admins[as])).body.data.items[0]).toMatchObject({ images: [{ url: photo.url }], productName: "Product A", authorName: "Asha M.", verified: true, orderNumber: c.order.orderNumber });
    }
  });

  it("keeps reviews written before photos existed, readable everywhere", async () => {
    const c = await buyer();
    // Exactly the previous shape: no `images` field at all, written while the order wasn't delivered.
    await Order.updateOne({ _id: c.order._id }, { status: "shipped" });
    const _id = new Types.ObjectId();
    await Review.collection.insertOne({ _id, product: product.a._id, user: c.id, order: c.order._id, payment: null, variantSku: product.a.sku, authorName: "Asha M.", rating: 4, title: "", comment: COMMENT, verifiedAt: new Date(), createdAt: new Date(), updatedAt: new Date() });
    await Product.collection.updateOne({ _id: product.a._id }, { $set: { reviewStats: { average: 4, count: 1 } } });
    expect(await publicList("product-a")).toMatchObject({ count: 1, items: [{ comment: COMMENT, images: [] }] });
    expect((await adminList(admins.owner)).body.data.items[0]).toMatchObject({ images: [], verified: true });
    expect((await states(c.order, c.jar)).body.data).toMatchObject([{ status: "reviewed", review: { rating: 4, images: [] } }]);
    expect((await loadCatalogSnapshot()).products.find((p) => p.slug === "product-a")).toMatchObject({ rating: 4, reviewCount: 1 });
    expect((await adminDelete(String(_id), admins.owner)).status).toBe(200);
    expect(await stats("a")).toEqual({ average: 0, count: 0 });
  });

  it("ignores unsupported review records everywhere shoppers look", async () => {
    await Review.collection.insertOne({ product: product.a._id, user: new Types.ObjectId(), order: new Types.ObjectId(), authorName: "Made Up", rating: 5, comment: "An unsupported record.", status: "approved", verified: true, createdAt: new Date() });
    const real = await buyer();
    await submit(real.order, real.jar, { rating: 2 });
    const list = await publicList("product-a");
    expect(list).toMatchObject({ average: 2, count: 1, distribution: [0, 0, 0, 1, 0] });
    expect(list.items.map((i: Rec) => i.authorName)).toEqual(["Asha M."]);
    const rows = (await adminList(admins.owner)).body.data.items as Rec[];
    expect(rows.find((r) => r.authorName === "Made Up")).toMatchObject({ verified: false, orderNumber: null, images: [] });
  });

  it("pages reviews and sorts the catalogue by genuine ratings", async () => {
    for (let i = 0; i < 12; i++) {
      const b = await buyer("Ravi Kumar Pillai", ["b"]);
      await submit(b.order, b.jar, { productId: product.b.id, rating: i < 6 ? 5 : 4 });
    }
    const first = await publicList("product-b");
    expect(first).toMatchObject({ average: 4.5, count: 12, distribution: [6, 6, 0, 0, 0], page: 1, totalPages: 2 });
    expect(first.items).toHaveLength(10);
    expect((await publicList("product-b", 2)).items).toHaveLength(2);
    expect(first.items[0].authorName).toBe("Ravi P.");
    const sorted = await listProducts({ sort: "rating", page: 1, limit: 10 });
    expect(sorted.items.map((p) => [p.slug, p.rating, p.reviewCount])).toEqual([["product-b", 4.5, 12], ["product-a", 0, 0]]);
  });

  it("never publishes a full name", () => {
    expect(["Asha Menon", "  Asha  ", "ravi kumar pillai", ""].map(displayName)).toEqual(["Asha M.", "Asha", "ravi P.", "Customer"]);
  });
});

/* ---------- Admin ---------- */

describe("admin review management", () => {
  async function twoReviews() {
    const first = await buyer("Asha Menon");
    const second = await buyer("Bala Nair");
    await submit(first.order, first.jar, { rating: 5, comment: "Lovely colour and stitching." });
    await submit(second.order, second.jar, { rating: 2, comment: "Runs small for my usual size." });
    return { first, second };
  }

  it("lists reviews with all details, with search and filter", async () => {
    const { second } = await twoReviews();
    for (const as of ["owner", "manager"] as const) expect((await adminList(admins[as])).body.data).toMatchObject({ total: 2, page: 1, totalPages: 1 });
    const [latest] = (await adminList(admins.owner)).body.data.items as Rec[];
    expect(latest).toMatchObject({ productName: "Product A", productSlug: "product-a", authorName: "Bala N.", rating: 2, comment: "Runs small for my usual size.", verified: true, orderNumber: second.order.orderNumber, orderNow: null });
    for (const [query, total] of [["?rating=5", 1], ["?q=bala", 1], ["?q=stitching", 1], ["?q=product%20a", 2], ["?q=(", 0], ["?limit=1&page=2", 2]] as const) {
      expect([query, (await adminList(admins.owner, query)).body.data.total]).toEqual([query, total]);
    }
    expect((await adminList(admins.owner, "?rating=9")).status).toBe(400);
  });

  it("keeps a review if its order is refunded later, and tells staff", async () => {
    const { second } = await twoReviews();
    await Order.updateOne({ _id: second.order._id }, { paymentStatus: "refunded" });
    expect((await publicList("product-a")).count).toBe(2);
    expect((await adminList(admins.owner)).body.data.items[0].orderNow).toBe("refunded");
  });

  it("Owner and Manager can delete; the rating and counts update everywhere", async () => {
    await twoReviews();
    expect(await stats("a")).toEqual({ average: 3.5, count: 2 });
    const items = (await adminList(admins.owner)).body.data.items as Rec[];
    expect((await adminDelete(items[0].id, admins.manager)).status).toBe(200);
    expect(await stats("a")).toEqual({ average: 5, count: 1 });
    expect(await publicList("product-a")).toMatchObject({ average: 5, count: 1, distribution: [1, 0, 0, 0, 0] });
    expect((await loadCatalogSnapshot()).products.find((p) => p.slug === "product-a")).toMatchObject({ rating: 5, reviewCount: 1 });
    expect((await adminDelete(items[1].id, admins.owner)).status).toBe(200);
    expect(await stats("a")).toEqual({ average: 0, count: 0 });
    expect((await adminDelete(items[1].id, admins.owner)).status).toBe(404);
    expect((await adminDelete("not-an-id", admins.owner)).status).toBe(400);
    expect((await AuditLog.find({ action: "review.delete" }).sort({ createdAt: 1 }).lean()).map((l) => l.actor!.name)).toEqual(["manager admin", "owner admin"]);
  });

  async function reviewWithPhotos(count = 2) {
    const c = await buyer();
    const photos = [];
    for (let i = 0; i < count; i++) photos.push(await addPhoto(c.order, c.jar));
    const r = await submit(c.order, c.jar, { imageIds: photos.map((p) => p.id) });
    expect(r.status).toBe(201);
    const ids = (await Review.findById(r.body.data.id).lean())!.images.map((i) => i.publicId);
    cloud.destroyed = [];
    return { ...c, reviewId: r.body.data.id as string, ids };
  }

  it("deleting a review deletes its photos", async () => {
    const r = await reviewWithPhotos();
    expect((await adminDelete(r.reviewId, admins.owner)).status).toBe(200);
    expect(cloud.destroyed.sort()).toEqual([...r.ids].sort());
    expect(await MediaAsset.countDocuments({ publicId: { $in: r.ids }, status: "deleted" })).toBe(2);
  });

  it("never deletes a photo another review still uses", async () => {
    const r = await reviewWithPhotos();
    const shared = r.ids[0];
    await Review.collection.insertOne({ product: product.b._id, user: new Types.ObjectId(), order: new Types.ObjectId(), authorName: "Other", rating: 4, comment: "Refers to the same image.", images: [{ publicId: shared, url: "https://res.cloudinary.com/testcloud/x.jpg" }], createdAt: new Date() });
    expect((await adminDelete(r.reviewId, admins.owner)).status).toBe(200);
    expect(cloud.destroyed).toEqual([r.ids[1]]);
    expect(cloud.files.has(shared)).toBe(true);
    await cleanupOrphanImages(0);
    expect(cloud.files.has(shared)).toBe(true);
  });

  it("deletes the review even if image deletion fails; the cleanup job finishes the job", async () => {
    const r = await reviewWithPhotos();
    cloud.fail = "destroy";
    expect((await adminDelete(r.reviewId, admins.owner)).status).toBe(200);
    expect(await Review.countDocuments()).toBe(0);
    expect(await stats("a")).toEqual({ average: 0, count: 0 });
    // Released: they can't be attached again.
    expect((await submit(r.order, r.jar, { imageIds: [String((await MediaAsset.findOne({ publicId: r.ids[0] }).lean())!._id)] })).status).toBe(400);
    cloud.fail = null;
    await cleanupOrphanImages(0);
    for (const id of r.ids) expect(cloud.files.has(id)).toBe(false);
  });

  it("the cleanup job removes abandoned uploads but keeps photos on reviews", async () => {
    const r = await reviewWithPhotos(1);
    const other = await buyer("Bala Nair");
    const unused = await addPhoto(other.order, other.jar);
    const abandoned = (await sign(other.order, other.jar)).body.data;
    cloud.put(abandoned.fields.public_id);
    // Even a record left as "uploaded" is kept while a review uses it.
    await MediaAsset.updateOne({ publicId: r.ids[0] }, { status: "uploaded" });
    await MediaAsset.collection.updateMany({}, { $set: { createdAt: new Date(Date.now() - 25 * 3600_000) } });
    await cleanupOrphanImages();
    expect([...cloud.files.keys()]).toEqual(r.ids);
    expect((await MediaAsset.findById(unused.id).lean())!.status).toBe("deleted");
    expect((await MediaAsset.findOne({ publicId: r.ids[0] }).lean())!.status).toBe("attached");
  });

  it("after deletion, a customer with a delivered order can write again", async () => {
    const c = await buyer();
    const created = await submit(c.order, c.jar);
    await adminDelete(created.body.data.id, admins.owner);
    expect(await stateOf(c.order, c.jar)).toBe("eligible");
    expect((await submit(c.order, c.jar)).status).toBe(201);
  });

  it("blocks Staff and everyone else from review moderation", async () => {
    const { first } = await twoReviews();
    const id = String((await Review.findOne().lean())!._id);
    for (const [jar, status] of [[null, 401], [first.jar, 401], [admins.staff, 403]] as const) {
      expect((await adminList(jar)).status).toBe(status);
      expect((await adminDelete(id, jar)).status).toBe(status);
    }
    expect((await adminDelete(id, admins.owner, "https://evil.example")).status).toBe(403);
    expect(await Review.countDocuments()).toBe(2);
  });

  it("follows the stored role: removing reviews:moderate from Manager removes access", async () => {
    await twoReviews();
    const id = String((await Review.findOne().lean())!._id);
    await Role.updateOne({ key: "manager" }, { $pull: { permissions: "reviews:moderate" } });
    try {
      expect((await adminList(admins.manager)).status).toBe(403);
      expect((await adminDelete(id, admins.manager)).status).toBe(403);
      expect((await adminList(admins.owner)).status).toBe(200);
    } finally {
      await Role.updateOne({ key: "manager" }, { $addToSet: { permissions: "reviews:moderate" } });
    }
  });

  it("grants Owner and Manager, not Staff, by default", () => {
    expect(["owner", "manager", "staff"].map((r) => DEFAULT_ROLE_PERMISSIONS[r as As].includes("reviews:moderate"))).toEqual([true, true, false]);
  });

  it("has no way to edit a review, and keeps its place in the navigation", () => {
    expect(Object.keys(adminReviewsRoute).filter((k) => /^[A-Z]+$/.test(k))).toEqual(["GET"]);
    expect(Object.keys(adminReviewRoute).filter((k) => /^[A-Z]+$/.test(k))).toEqual(["DELETE"]);
    expect(ADMIN_NAV.flatMap((g) => g.items.map((i) => i.href))).toContain("/mm-hub/reviews");
  });
});

/* ---------- Order page rules and isolation ---------- */

describe("order page controls", () => {
  const eligible = { productId: "p", status: "eligible", review: null } as const;

  it("enables Write Review only for a delivered order the server calls eligible", () => {
    expect(itemReviewView("authenticated", "Delivered", eligible)).toEqual({ button: "on", message: null, reviewed: false });
    for (const status of ["Payment Pending", "Order Placed", "Confirmed", "Processing", "Packed", "Shipped", "Out for Delivery"] as StoreOrderStatus[]) {
      // Even if a stale answer said otherwise.
      expect([status, itemReviewView("authenticated", status, eligible)]).toEqual([status, { button: "off", message: "You can review this product after delivery.", reviewed: false }]);
    }
    for (const status of ["Cancelled", "Expired", "Payment Failed"] as StoreOrderStatus[]) expect(itemReviewView("authenticated", status, null)).toMatchObject({ button: "hidden", message: null });
    expect(itemReviewView("unknown", "Delivered", eligible).button).toBe("off");
    expect(itemReviewView("authenticated", "Delivered", null).button).toBe("off");
    expect(itemReviewView("authenticated", "Delivered", null, "error")).toMatchObject({ button: "off", retry: true });
    expect(itemReviewView("authenticated", "Delivered", { ...eligible, status: "unavailable" }).button).toBe("hidden");
    expect(itemReviewView("authenticated", "Delivered", null, "not-yours").button).toBe("hidden");
    expect(itemReviewView("anonymous", "Delivered", eligible).button).toBe("hidden");
    expect(itemReviewView("authenticated", "Delivered", { ...eligible, status: "reviewed" })).toMatchObject({ button: "hidden", reviewed: true });
  });

  it("blocks submitting while a photo is uploading or after one failed", () => {
    expect(uploadBlocker([])).toBeNull();
    expect(uploadBlocker([{ status: "done" }])).toBeNull();
    expect(uploadBlocker([{ status: "done" }, { status: "uploading" }])).toMatch(/finish uploading/);
    expect(uploadBlocker([{ status: "done" }, { status: "error" }])).toMatch(/Remove the photo that failed/);
  });

  it("checks chosen files before uploading them", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) expect(checkReviewImage({ name: "a", type, size: 5 * MB })).toBeNull();
    expect(checkReviewImage({ name: "a.jpg", type: "image/jpeg", size: 5 * MB + 1 })).toMatch(/larger than 5 MB/);
    expect(checkReviewImage({ name: "a.gif", type: "image/gif", size: 10 })).toMatch(/JPG, PNG or WebP/);
  });
});

describe("isolation", () => {
  it("reviewing with a photo and deleting change nothing about orders, payments, stock or history", async () => {
    const c = await buyer();
    const snapshot = async () => {
      const p = (await Product.findById(product.a._id).lean())!;
      return JSON.stringify({
        orders: await Order.find().lean(),
        payments: await Payment.find().lean(),
        variants: p.variants,
        price: [p.pricePaise, p.mrpPaise, p.soldCount, p.inStock],
        updatedAt: (p as Rec).updatedAt,
        movements: await models.InventoryMovement.countDocuments(),
        coupons: await models.Coupon.find().lean(),
        history: (await call(myOrdersRoute(req("/api/v1/orders", { jar: c.jar }), ctx()))).body.data,
      });
    };
    const before = await snapshot();
    const photo = await addPhoto(c.order, c.jar);
    const created = await submit(c.order, c.jar, { imageIds: [photo.id] });
    expect(await snapshot()).toBe(before);
    await adminDelete(created.body.data.id, admins.owner);
    expect(await snapshot()).toBe(before);
    expect(fetchSpy.mock.calls.every(([url]) => String(url).startsWith("https://api.cloudinary.com/"))).toBe(true);
  });
});
