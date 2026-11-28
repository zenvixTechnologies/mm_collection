import { MongoMemoryReplSet } from "mongodb-memory-server";
import { Types } from "mongoose";
import { NextRequest, type NextResponse } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as addRoute } from "@/app/api/v1/cart/items/route";
import { PATCH as updateRoute } from "@/app/api/v1/cart/items/[id]/route";
import { POST as mergeRoute } from "@/app/api/v1/cart/merge/route";
import { GET as cartRoute } from "@/app/api/v1/cart/route";
import { POST as placeRoute } from "@/app/api/v1/checkout/orders/route";
import { POST as quoteRoute } from "@/app/api/v1/checkout/validate/route";
import { GET as productRoute } from "@/app/api/v1/products/[ref]/route";
import { VariantPicker } from "@/components/products/VariantPicker";
import { categories } from "@/data/categories";
import { products as catalogue } from "@/data/products";
import { colorSelectable, sizeInStock, unitsFor, withVariants } from "@/lib/availability";
import { publishedAtFor, toProductDoc } from "@/server/catalog/legacy-import";
import { resetEnvCache } from "@/server/config/env";
import { connectToDatabase, disconnectFromDatabase } from "@/server/db/connect";
import * as models from "@/server/models";
import { Cart, Category, InventoryMovement, Order, Product } from "@/server/models";
import { resetRateLimits } from "@/server/security/rate-limit";
import { loadCatalogSnapshot } from "@/server/services/catalog.service";
import type { Product as StoreProduct } from "@/types";

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }));

/**
 * Availability per variant (size × colour), on the storefront data, in the size picker, and on
 * the server's cart and checkout APIs. Throwaway in-memory replica set; no network.
 */

const ORIGIN = "http://localhost:3000";
const PRICE = 79900;
type Jar = Record<string, string>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>;
let rs: MongoMemoryReplSet;
let topId: string;
let seq = 0;

function req(path: string, init: { method?: string; body?: unknown; jar?: Jar } = {}) {
  seq += 1;
  const headers: Record<string, string> = { origin: ORIGIN, "x-forwarded-for": `10.5.${Math.floor(seq / 250) % 250}.${seq % 250}` };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.jar && Object.keys(init.jar).length) headers.cookie = Object.entries(init.jar).map(([k, v]) => `${k}=${v}`).join("; ");
  return new NextRequest(`${ORIGIN}${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}
const ctx = <T extends Record<string, string>>(params: T = {} as T) => ({ params: Promise.resolve(params) });
async function call(res: Response | Promise<Response>, jar?: Jar) {
  const r = (await res) as NextResponse;
  if (jar) for (const c of r.cookies?.getAll() ?? []) if (c.value) jar[c.name] = c.value;
  return { status: r.status, body: (await r.json()) as { message: string; data: Rec; error?: { code: string } } };
}
const add = (jar: Jar, size: string | null, color: string | null, quantity = 1, productId = topId) =>
  call(addRoute(req("/api/v1/cart/items", { method: "POST", body: { productId, size, color, quantity }, jar }), ctx()), jar);
const setQty = (jar: Jar, sku: string, quantity: number) => call(updateRoute(req(`/api/v1/cart/items/${sku}`, { method: "PATCH", body: { quantity }, jar }), ctx({ id: sku })), jar);
const cart = async (jar: Jar) => (await call(cartRoute(req("/api/v1/cart", { jar }), ctx()), jar)).body.data;
const quote = (jar: Jar, source: Rec = { type: "cart" }) => call(quoteRoute(req("/api/v1/checkout/validate", { method: "POST", body: { source }, jar }), ctx()), jar);
const buyNow = (size: string | null, color: string | null, quantity = 1) => ({ type: "buy-now", item: { productId: topId, size, color, quantity } });
const place = (jar: Jar, source: Rec, expectedTotalPaise: number) =>
  call(
    placeRoute(
      req("/api/v1/checkout/orders", {
        method: "POST",
        jar,
        body: {
          source,
          customer: { fullName: "Asha Menon", email: "asha@example.com", mobile: "9876543210" },
          address: { house: "1 Test House", street: "MG Road", city: "Kochi", district: "Ernakulam", state: "Kerala", pincode: "682001" },
          paymentMethod: "upi",
          idempotencyKey: `variant-${Date.now()}-${++seq}-abcdef`,
          expectedTotalPaise,
        },
      }),
      ctx(),
    ),
    jar,
  );

const sku = (size: string, color = "Black") => `MM-TOP-${size}-${color.toUpperCase()}`;
const variant = async (s: string) => (await Product.findById(topId).lean())!.variants.find((v) => v.sku === s)!;
const setStock = (s: string, stock: number, reserved = 0) => Product.updateOne({ _id: topId, "variants.sku": s }, { $set: { "variants.$.stock": stock, "variants.$.reserved": reserved } });
const storeProduct = async (slug = "test-top") => (await loadCatalogSnapshot()).products.find((p) => p.slug === slug)!;

/** The task's example: S 5, M 3, L 0, XL 4, XXL 0 — plus a second colour with different stock. */
const STOCK = { Black: { S: 5, M: 3, L: 0, XL: 4, XXL: 0 }, White: { S: 0, M: 2, L: 6, XL: 0, XXL: 0 } } as const;
const SIZES = ["S", "M", "L", "XL", "XXL"] as const;

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  vi.stubEnv("MONGODB_URI", rs.getUri());
  vi.stubEnv("MONGODB_DB_NAME", "mm-variant-test");
  vi.stubEnv("JWT_ACCESS_SECRET", "a".repeat(48));
  vi.stubEnv("JWT_REFRESH_SECRET", "r".repeat(48));
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  resetEnvCache();
  await connectToDatabase();
  for (const m of Object.values(models)) {
    await m.createCollection();
    await m.syncIndexes();
  }
  const cats = await Category.insertMany(categories.map((c, i) => ({ slug: c.slug, audience: c.audience, name: c.name, sortOrder: i })));
  const catId = new Map<string, Types.ObjectId>(cats.map((c) => [String(c.slug), c._id as Types.ObjectId]));
  // The existing catalogue, exactly as the seed imports it (includes Home & Living and Free Size).
  const anchor = new Date("2026-11-01T00:00:00Z");
  for (const [i, p] of catalogue.entries()) await Product.create(toProductDoc(p, (s) => catId.get(s)!, publishedAtFor(i, catalogue.length, anchor)));
  vi.stubGlobal("fetch", vi.fn(async (u: unknown) => {
    throw new Error(`Unexpected network call: ${String(u)}`);
  }));
}, 240_000);

beforeEach(async () => {
  await Promise.all([Product.deleteMany({ slug: "test-top" }), Cart.deleteMany({}), Order.deleteMany({}), InventoryMovement.deleteMany({})]);
  const top = await Product.create({
    slug: "test-top",
    name: "Test Top",
    sku: "MM-TOP",
    audience: "women",
    category: (await Category.findOne({ slug: "tops" }))!._id,
    status: "active",
    pricePaise: 0,
    mrpPaise: 0,
    variants: (["Black", "White"] as const).flatMap((color) => SIZES.map((size) => ({ sku: sku(size, color), size, color: { name: color, hex: color === "Black" ? "#000000" : "#ffffff" }, pricePaise: PRICE, mrpPaise: PRICE, stock: STOCK[color][size] }))),
  });
  topId = String(top._id);
  resetRateLimits();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await disconnectFromDatabase();
  await rs?.stop();
  vi.unstubAllEnvs();
  resetEnvCache();
});

/* ---------- Storefront data and rules ---------- */

describe("variant stock on the storefront", () => {
  it("sends each variant's available units, matching the product total", async () => {
    const p = await storeProduct();
    expect(p.variants).toHaveLength(10);
    expect(p.variants!.filter((v) => v.color === "Black").map((v) => [v.size, v.stock])).toEqual([["S", 5], ["M", 3], ["L", 0], ["XL", 4], ["XXL", 0]]);
    expect(p.stock).toBe(20);
  });

  it("counts units held by unpaid checkouts as unavailable, and leaves out inactive variants", async () => {
    await setStock(sku("M"), 3, 3);
    await Product.updateOne({ _id: topId, "variants.sku": sku("XL") }, { $set: { "variants.$.isActive": false } });
    const p = await storeProduct();
    expect(sizeInStock(p, "M", "Black")).toBe(false);
    expect(sizeInStock(p, "XL", "Black")).toBe(false);
    expect(p.variants!.some((v) => v.size === "XL" && v.color === "Black")).toBe(false);
    for (const key of ["reserved", "sku", "pricePaise"]) expect(JSON.stringify(p.variants)).not.toContain(key);
  });

  it("serves current stock from the product API the picker refreshes from", async () => {
    await setStock(sku("S"), 0);
    const r = await call(productRoute(req("/api/v1/products/test-top"), ctx({ ref: "test-top" })));
    expect(r.body.data.product.variants.find((v: Rec) => v.size === "S" && v.color === "Black")).toEqual({ size: "S", color: "Black", stock: 0 });
  });

  it("decides availability for the chosen colour, or any colour before one is chosen", async () => {
    const p = await storeProduct();
    const open = (color: string | null) => SIZES.filter((s) => sizeInStock(p, s, color));
    expect(open("Black")).toEqual(["S", "M", "XL"]);
    expect(open("White")).toEqual(["M", "L"]);
    expect(open(null)).toEqual(["S", "M", "L", "XL"]); // XXL is sold out in every colour
    expect([unitsFor(p, { size: "M", color: "Black" }), unitsFor(p, { size: "M" }), unitsFor(p, { color: "White" }), unitsFor(p)]).toEqual([3, 5, 8, 20]);
    expect(colorSelectable(p, "White")).toBe(true);
  });

  it("falls back to the total only when there's no variant data, and keeps totals in step with fresh data", () => {
    const bare = { stock: 3, sizes: ["M"], variants: undefined } as unknown as StoreProduct;
    expect(unitsFor(bare, { size: "M" })).toBe(3);
    expect(withVariants(bare, [{ size: "M", color: null, stock: 0 }]).stock).toBe(0);
    expect(withVariants(bare, null)).toBe(bare);
  });

  it("keeps the catalogue snapshot within Next.js's 2 MB cache limit", async () => {
    const bytes = Buffer.byteLength(JSON.stringify(await loadCatalogSnapshot()));
    expect(bytes).toBeLessThan(1_000_000);
  });
});

/* ---------- The size picker ---------- */

describe("size picker", () => {
  const render = (p: StoreProduct, color: string | null, size: string | null = null) =>
    renderToStaticMarkup(createElement(VariantPicker, { product: p, size: size as never, color, onSize: () => undefined, onColor: () => undefined, errors: {}, idPrefix: "t" }));
  const sizeInputs = (html: string) =>
    Object.fromEntries([...html.matchAll(/<input[^>]*name="t-size"[^>]*>/g)].map(([tag]) => [/value="([^"]+)"/.exec(tag)![1], / disabled=""/.test(tag)]));

  it("disables only the sizes with no stock — one or several", async () => {
    const p = await storeProduct();
    expect(sizeInputs(render(p, "Black"))).toEqual({ S: false, M: false, L: true, XL: false, XXL: true });
    await setStock(sku("L"), 2);
    expect(sizeInputs(render(await storeProduct(), "Black"))).toEqual({ S: false, M: false, L: false, XL: false, XXL: true });
  });

  it("updates with the colour", async () => {
    const p = await storeProduct();
    expect(sizeInputs(render(p, "White"))).toEqual({ S: true, M: false, L: false, XL: true, XXL: true });
    expect(sizeInputs(render(p, null))).toEqual({ S: false, M: false, L: false, XL: false, XXL: true });
  });

  it("marks sold-out sizes visibly and for screen readers", async () => {
    const html = render(await storeProduct(), "Black");
    expect(html.match(/line-through/g)).toHaveLength(2);
    expect(html.match(/, out of stock<\/span>/g)).toHaveLength(2);
    expect(html).toContain('title="L — out of stock in Black"');
  });

  it("disables every size when everything is sold out", async () => {
    await Product.updateOne({ _id: topId }, { $set: { "variants.$[].stock": 0 } });
    const p = await storeProduct();
    expect(p.stock).toBe(0);
    expect(Object.values(sizeInputs(render(p, "Black")))).toEqual([true, true, true, true, true]);
  });

  it("says when a whole colour is sold out, keeping the colour selectable", async () => {
    await Product.updateOne({ _id: topId }, { $set: { "variants.$[w].stock": 0 } }, { arrayFilters: [{ "w.color.name": "White" }] });
    const html = render(await storeProduct(), "White");
    expect(html).toContain("No sizes are in stock in White. Try another colour.");
    expect(/<input[^>]*name="t-color"[^>]*value="White"[^>]*>/.exec(html)![0]).not.toContain("disabled");
  });

  it("disables a sold-out colour only on products without sizes", () => {
    const cushion = { stock: 3, sizes: [], colors: [{ name: "Red", hex: "#ff0000" }, { name: "Blue", hex: "#0000ff" }], variants: [{ size: null, color: "Red", stock: 3 }, { size: null, color: "Blue", stock: 0 }] } as unknown as StoreProduct;
    const tags = [...render(cushion, null).matchAll(/<input[^>]*name="t-color"[^>]*>/g)].map(([t]) => t.includes('disabled=""'));
    expect(tags).toEqual([false, true]);
  });
});

/* ---------- Server: cart and checkout ---------- */

describe("cart API", () => {
  it("refuses a sold-out variant sent directly, whatever the browser claims", async () => {
    const jar: Jar = {};
    for (const [size, color] of [["L", "Black"], ["XXL", "Black"], ["S", "White"]]) {
      const r = await add(jar, size, color);
      expect([size, color, r.status, r.body.message]).toEqual([size, color, 409, `Sorry, Test Top (${size} / ${color}) is out of stock.`]);
    }
    const cheat = await call(addRoute(req("/api/v1/cart/items", { method: "POST", body: { productId: topId, size: "L", color: "Black", quantity: 1, stock: 99, variantSku: sku("S") }, jar }), ctx()), jar);
    expect(cheat.status).toBe(409);
    expect((await cart(jar)).items).toEqual([]);
  });

  it("accepts a variant with stock, up to exactly its own units", async () => {
    const jar: Jar = {};
    expect((await add(jar, "M", "Black", 3)).status).toBe(200);
    const more = await add(jar, "M", "Black");
    expect(more.status).toBe(409);
    expect(more.body.message).toContain("all 3 available units");
    // The same size in another colour is counted separately.
    expect((await add(jar, "M", "White", 2)).status).toBe(200);
    expect((await cart(jar)).items.map((i: Rec) => [i.key, i.quantity, i.stock])).toEqual([[sku("M"), 3, 3], [sku("M", "White"), 2, 2]]);
  });

  it("refuses combinations that don't exist, and a missing size or colour", async () => {
    const jar: Jar = {};
    for (const [size, color] of [["XS", "Black"], ["M", "Green"], [null, "Black"], ["M", null]] as const) expect((await add(jar, size, color)).status).toBe(400);
  });

  it("checks that variant's stock on quantity updates", async () => {
    const jar: Jar = {};
    await add(jar, "S", "Black");
    const r = await setQty(jar, sku("S"), 6);
    expect([r.status, r.body.message]).toEqual([409, "Only 5 units of Test Top (S / Black) are available."]);
    expect((await setQty(jar, sku("S"), 5)).status).toBe(200);
  });

  it("removes a line whose variant sells out later, keeping the others", async () => {
    const jar: Jar = {};
    await add(jar, "S", "Black", 2);
    await add(jar, "XL", "Black", 3);
    await setStock(sku("S"), 0);
    await setStock(sku("XL"), 1);
    expect((await setQty(jar, sku("S"), 1)).status).toBe(404);
    const after = await cart(jar);
    expect(after.items.map((i: Rec) => [i.key, i.quantity])).toEqual([[sku("XL"), 1]]);
  });

  it("skips sold-out variants when merging a saved bag", async () => {
    const jar: Jar = {};
    const items = [{ productId: topId, size: "L", color: "Black", quantity: 1 }, { productId: topId, size: "L", color: "White", quantity: 1 }];
    const r = await call(mergeRoute(req("/api/v1/cart/merge", { method: "POST", body: { items }, jar }), ctx()), jar);
    expect(r.body.data.items.map((i: Rec) => i.key)).toEqual([sku("L", "White")]);
    expect(r.body.data.notices.join(" ")).toContain("Test Top (L / Black) is sold out");
  });
});

describe("checkout", () => {
  it("won't quote or place a Buy Now for a sold-out variant", async () => {
    const jar: Jar = {};
    const q = await quote(jar, buyNow("L", "Black"));
    expect(q.body.data.canPlaceOrder).toBe(false);
    expect(q.body.data.issues[0]).toMatchObject({ code: "out_of_stock", sku: sku("L"), blocking: true });
    const guest: Jar = {};
    await add(guest, "S", "Black"); // establishes a guest session
    const r = await place(guest, buyNow("L", "Black"), PRICE);
    expect(r.status).toBe(409);
    expect(r.body.message).toContain("Test Top (L / Black) is out of stock");
    expect(await Order.countDocuments()).toBe(0);
    expect(await InventoryMovement.countDocuments()).toBe(0);
  });

  it("limits Buy Now to the chosen variant's units, not the product total", async () => {
    const q = await quote({}, buyNow("M", "Black", 4));
    expect(q.body.data).toMatchObject({ canPlaceOrder: false });
    expect(q.body.data.issues[0]).toMatchObject({ code: "insufficient_stock" });
  });

  it("stops the whole order when one bag item sells out before it's placed", async () => {
    const jar: Jar = {};
    await add(jar, "S", "Black");
    await add(jar, "XL", "Black");
    expect((await quote(jar)).body.data.canPlaceOrder).toBe(true);
    await setStock(sku("XL"), 4, 4); // all held by other checkouts
    const r = await place(jar, { type: "cart" }, 2 * PRICE);
    expect([r.status, r.body.error?.code]).toEqual([409, "CART_CHANGED"]);
    expect(await Order.countDocuments()).toBe(0);
    expect((await variant(sku("S"))).reserved).toBe(0);
  });

  it("holds the ordered variant only, and sells the last unit once", async () => {
    await setStock(sku("XL"), 1);
    const buyers: Jar[] = [{}, {}, {}];
    for (const jar of buyers) await add(jar, "XL", "Black");
    const results = await Promise.all(buyers.map((jar) => place(jar, { type: "cart" }, PRICE)));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await variant(sku("XL"))).toMatchObject({ stock: 1, reserved: 1 });
    expect(await variant(sku("S"))).toMatchObject({ stock: 5, reserved: 0 });
    const p = await storeProduct();
    expect(sizeInStock(p, "XL", "Black")).toBe(false);
    expect(p.stock).toBeGreaterThan(0);
  });
});

/* ---------- Home & Living and other variant types ---------- */

describe("Home & Living and single-size variants", () => {
  /** As the admin creates them: the seed catalogue has the categories but no Home & Living products. */
  async function homeProduct(slug: string, category: string, sizes: [string, number][], colors: (string | null)[] = [null]) {
    await Product.deleteMany({ slug });
    const doc = await Product.create({
      slug,
      name: slug,
      sku: slug.toUpperCase(),
      audience: "home-living",
      category: (await Category.findOne({ slug: category }))!._id,
      status: "active",
      pricePaise: 0,
      mrpPaise: 0,
      variants: colors.flatMap((color) => sizes.map(([size, stock], i) => ({ sku: `${slug}-${i}-${color ?? "x"}`.toUpperCase(), size, color: color ? { name: color, hex: "#eeeeee" } : null, pricePaise: PRICE, mrpPaise: PRICE, stock }))),
    });
    return { id: String(doc._id), store: await storeProduct(slug) };
  }

  it.each([
    ["bedsheet", "home-bedsheets", [["Single", 4], ["Double", 0], ["Queen", 2], ["King", 0]]],
    ["pillow-cover", "home-pillow-covers", [["Standard", 0], ["Queen", 3]]],
    ["cushion-cover", "home-cushion-covers", [["16 × 16 in", 5], ["18 × 18 in", 0], ["24 × 24 in", 1]]],
  ] as [string, string, [string, number][]][])("%s: disables and refuses only the sold-out sizes", async (slug, category, sizes) => {
    const { id, store } = await homeProduct(slug, category, sizes);
    expect(store.sizes).toEqual(sizes.map(([size]) => size));
    const jar: Jar = {};
    for (const [size, stock] of sizes) {
      expect([size, sizeInStock(store, size, null)]).toEqual([size, stock > 0]);
      expect([size, (await add(jar, size, null, 1, id)).status]).toEqual([size, stock > 0 ? 200 : 409]);
    }
    const html = renderToStaticMarkup(createElement(VariantPicker, { product: store, size: null, color: null, onSize: () => undefined, onColor: () => undefined, errors: {}, idPrefix: "h" }));
    expect(html.match(/name="h-size"[^>]*disabled=""|disabled=""[^>]*name="h-size"/g)).toHaveLength(sizes.filter(([, n]) => n === 0).length);
  });

  it("a single 'Standard' or 'Free Size' variant sold out makes the whole product out of stock", async () => {
    const { id, store } = await homeProduct("standard-only", "home-pillow-covers", [["Standard", 0]]);
    expect(store.stock).toBe(0);
    expect((await add({}, "Standard", null, 1, id)).status).toBe(409);
    const free = (await loadCatalogSnapshot()).products.find((p) => p.sizes.length === 1 && p.sizes[0] === "Free Size" && p.colors.length > 1)!;
    expect(free, "a Free Size product with colours in the existing catalogue").toBeTruthy();
    const doc = (await Product.findOne({ slug: free.slug }))!;
    const original = doc.variants.map((v) => v.stock);
    try {
      for (const v of doc.variants) v.stock = v.color!.name === free.colors[0].name ? 0 : 2;
      await doc.save();
      const fresh = await storeProduct(free.slug);
      expect(sizeInStock(fresh, "Free Size", free.colors[0].name)).toBe(false);
      expect(sizeInStock(fresh, "Free Size", free.colors[1].name)).toBe(true);
      expect(fresh.stock).toBeGreaterThan(0);
    } finally {
      doc.variants.forEach((v, i) => (v.stock = original[i]));
      await doc.save();
    }
  });

  it("every product in the existing catalogue has variant stock that adds up to its total", async () => {
    const { products } = await loadCatalogSnapshot();
    expect(products.length).toBeGreaterThan(80);
    for (const p of products) expect([p.slug, unitsFor(p)]).toEqual([p.slug, p.stock]);
  });
});
