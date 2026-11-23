import { MongoMemoryReplSet } from "mongodb-memory-server";
import { NextRequest, type NextResponse } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login } from "@/app/api/v1/admin/auth/login/route";
import { GET as listCats, POST as createCat } from "@/app/api/v1/admin/categories/route";
import { DELETE as deleteCat, PATCH as patchCat } from "@/app/api/v1/admin/categories/[id]/route";
import { POST as moveCat } from "@/app/api/v1/admin/categories/[id]/move/route";
import { GET as listInv } from "@/app/api/v1/admin/inventory/route";
import { POST as adjust } from "@/app/api/v1/admin/inventory/adjust/route";
import { GET as movements } from "@/app/api/v1/admin/inventory/movements/route";
import { PATCH as threshold } from "@/app/api/v1/admin/inventory/threshold/route";
import { GET as listProducts, POST as createProd } from "@/app/api/v1/admin/products/route";
import { DELETE as deleteProd, GET as getProd, PUT as putProd } from "@/app/api/v1/admin/products/[id]/route";
import { POST as bulk } from "@/app/api/v1/admin/products/bulk/route";
import { POST as confirmUpload } from "@/app/api/v1/admin/uploads/confirm/route";
import { POST as signUpload } from "@/app/api/v1/admin/uploads/sign/route";
import { DEFAULT_ROLE_PERMISSIONS } from "@/server/auth/permissions";
import { hashPassword } from "@/server/auth/password";
import { resetEnvCache } from "@/server/config/env";
import { connectToDatabase, disconnectFromDatabase } from "@/server/db/connect";
import { signParams } from "@/server/integrations/cloudinary/client";
import * as models from "@/server/models";
import { Admin, Category, InventoryMovement, MediaAsset, Product, Role, StoreSettings } from "@/server/models";
import { loadCatalogSnapshot } from "./catalog.service";

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn() }));

const ORIGIN = "http://localhost:3000";
const PW = "Correct-horse-42";
const IMG = "https://images.unsplash.com/photo-1496747611176-843222e1e57c?ar=4:5";
let rs: MongoMemoryReplSet;
type Jar = Record<string, string>;
const jars: Record<string, Jar> = {};

function req(path: string, init: { method?: string; body?: unknown; as?: string } = {}) {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const jar = jars[init.as ?? "owner"];
  if (jar) headers.cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
  return new NextRequest(`${ORIGIN}${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}
const p = <T extends Record<string, string>>(params: T = {} as T) => ({ params: Promise.resolve(params) });
const json = async (res: Response) => (await res.json()) as { success: boolean; message: string; data: any; error?: { code: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any

function productBody(over: Record<string, unknown> = {}) {
  return {
    name: "Test Linen Kurti",
    slug: "test-linen-kurti",
    sku: "MM-TST-1",
    audience: "women",
    category: "kurtis",
    tags: ["ethnic-wear"],
    images: [{ url: IMG }],
    pricePaise: 129900,
    mrpPaise: 189900,
    variants: [
      { size: "M", color: { name: "Ivory", hex: "#F4EFE6" }, initialStock: 5 },
      { size: "L", color: { name: "Ivory", hex: "#F4EFE6" }, initialStock: 3 },
    ],
    status: "active",
    ...over,
  };
}

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  vi.stubEnv("MONGODB_URI", rs.getUri());
  vi.stubEnv("MONGODB_DB_NAME", "mm-admin-catalog-test");
  vi.stubEnv("JWT_ACCESS_SECRET", "a".repeat(48));
  vi.stubEnv("JWT_REFRESH_SECRET", "r".repeat(48));
  vi.stubEnv("CLOUDINARY_CLOUD_NAME", "testcloud");
  vi.stubEnv("CLOUDINARY_API_KEY", "123456789012345");
  vi.stubEnv("CLOUDINARY_API_SECRET", "test-secret-value");
  resetEnvCache();
  await connectToDatabase();
  for (const m of Object.values(models)) {
    await m.createCollection();
    await m.syncIndexes();
  }
  for (const [key, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) await Role.create({ key, name: key, permissions: [...permissions] });
  for (const key of ["owner", "staff"] as const) {
    const role = await Role.findOne({ key });
    await Admin.create({ name: key, email: `${key}@t.in`, passwordHash: await hashPassword(PW), role: role!._id });
    const res = await login(req("/api/v1/admin/auth/login", { method: "POST", body: { identifier: `${key}@t.in`, password: PW }, as: "none" }), p());
    jars[key] = Object.fromEntries((res as NextResponse).cookies.getAll().map((c) => [c.name, c.value]));
  }
}, 240_000);

beforeEach(async () => {
  await Promise.all([Product.deleteMany({}), Category.deleteMany({}), InventoryMovement.deleteMany({}), StoreSettings.deleteMany({}), MediaAsset.deleteMany({})]);
  await Category.insertMany([
    { slug: "kurtis", audience: "women", name: "Kurtis", sortOrder: 0 },
    { slug: "ethnic-wear", audience: "women", name: "Ethnic Wear", sortOrder: 1 },
    { slug: "dresses", audience: "women", name: "Dresses", sortOrder: 2 },
    { slug: "men-shirts", audience: "men", name: "Shirts", sortOrder: 0 },
  ]);
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  await disconnectFromDatabase();
  await rs?.stop();
  vi.unstubAllEnvs();
  resetEnvCache();
});

async function create(over: Record<string, unknown> = {}) {
  const res = await createProd(req("/api/v1/admin/products", { method: "POST", body: productBody(over) }), p());
  return { res, body: await json(res) };
}

describe("admin products", () => {
  it("requires sign-in and the right permission", async () => {
    expect((await listProducts(req("/api/v1/admin/products", { as: "none" }), p())).status).toBe(401);
    expect((await listProducts(req("/api/v1/admin/products", { as: "staff" }), p())).status).toBe(200);
    const res = await createProd(req("/api/v1/admin/products", { method: "POST", body: productBody(), as: "staff" }), p());
    expect(res.status).toBe(403);
  });

  it("creates a product with variants, opening stock ledger and storefront visibility", async () => {
    const { res, body } = await create();
    expect(res.status).toBe(201);
    expect(body.data).toMatchObject({ name: "Test Linen Kurti", price: 1299, originalPrice: 1899, stock: 8, status: "active", sizes: ["M", "L"] });
    expect(body.data.variants.map((v: { sku: string }) => v.sku)).toEqual(["MM-TST-1-M-IVORY", "MM-TST-1-L-IVORY"]);
    expect(await InventoryMovement.countDocuments({ type: "restock" })).toBe(2);
    const snap = await loadCatalogSnapshot();
    expect(snap.products.find((x) => x.slug === "test-linen-kurti")).toMatchObject({ stock: 8, categoryId: "kurtis", tags: ["ethnic-wear"] });
  });

  it("validates prices, images, categories and duplicates", async () => {
    expect((await create({ pricePaise: 300000 })).res.status).toBe(400);
    expect((await create({ images: [] })).res.status).toBe(400); // active without images
    expect((await create({ images: [{ url: "https://evil.example/x.jpg" }] })).res.status).toBe(400);
    expect((await create({ category: "men-shirts" })).res.status).toBe(400); // wrong audience
    expect((await create({ pricePaise: 1299.5 })).res.status).toBe(400); // whole paise only
    await create();
    const dup = await create({ sku: "MM-TST-2" });
    expect(dup.res.status).toBe(409);
    expect(dup.body.message).toMatch(/URL slug/);
  });

  it("updates details without touching existing stock; removed variants are deactivated, new ones get opening stock", async () => {
    const { body } = await create();
    const id = body.data.id;
    // Someone sells / reserves meanwhile — the save must not overwrite it.
    await Product.updateOne({ _id: id, "variants.sku": "MM-TST-1-M-IVORY" }, { $set: { "variants.$.stock": 4, "variants.$.reserved": 1 } });
    const res = await putProd(
      req(`/api/v1/admin/products/${id}`, {
        method: "PUT",
        body: productBody({
          pricePaise: 99900,
          variants: [
            { size: "M", color: { name: "Ivory", hex: "#F4EFE6" }, initialStock: 999 }, // ignored for existing
            { size: "XL", color: { name: "Ivory", hex: "#F4EFE6" }, initialStock: 6 },
          ],
        }),
      }),
      p({ id }),
    );
    expect(res.status).toBe(200);
    const doc = await Product.findById(id).lean();
    const bySku = Object.fromEntries(doc!.variants.map((v) => [v.sku, v]));
    expect(bySku["MM-TST-1-M-IVORY"]).toMatchObject({ stock: 4, reserved: 1, pricePaise: 99900, isActive: true });
    expect(bySku["MM-TST-1-L-IVORY"]).toMatchObject({ stock: 3, isActive: false });
    expect(bySku["MM-TST-1-XL-IVORY"]).toMatchObject({ stock: 6, isActive: true });
    expect(doc!.pricePaise).toBe(99900);
    expect(await InventoryMovement.countDocuments({ variantSku: "MM-TST-1-XL-IVORY" })).toBe(1);
  });

  it("refuses to delete a product with reserved stock, otherwise deletes and unfeatures it", async () => {
    const { body } = await create();
    const id = body.data.id;
    await StoreSettings.create({ homepage: { featuredProducts: [id] } });
    await Product.updateOne({ _id: id }, { $set: { "variants.0.reserved": 1 } });
    expect((await deleteProd(req(`/api/v1/admin/products/${id}`, { method: "DELETE" }), p({ id }))).status).toBe(409);
    await Product.updateOne({ _id: id }, { $set: { "variants.0.reserved": 0 } });
    expect((await deleteProd(req(`/api/v1/admin/products/${id}`, { method: "DELETE", as: "staff" }), p({ id }))).status).toBe(403);
    expect((await deleteProd(req(`/api/v1/admin/products/${id}`, { method: "DELETE" }), p({ id }))).status).toBe(200);
    expect(await Product.countDocuments()).toBe(0);
    expect((await StoreSettings.findOne().lean())!.homepage!.featuredProducts).toHaveLength(0);
  });

  it("bulk-publishes only products that have images", async () => {
    const a = (await create({ status: "draft" })).body.data.id;
    const b = (await create({ status: "draft", slug: "no-img", sku: "MM-TST-9", images: [] })).body.data.id;
    const res = await bulk(req("/api/v1/admin/products/bulk", { method: "POST", body: { action: "status", ids: [a, b], status: "active" } }), p());
    const out = await json(res);
    expect(out.data.updated).toEqual([a]);
    expect(out.data.skipped).toHaveLength(1);
    expect((await Product.findById(a).lean())!.status).toBe("active");
    expect((await Product.findById(b).lean())!.status).toBe("draft");
  });

  it("gets a product by slug", async () => {
    await create();
    const res = await getProd(req("/api/v1/admin/products/test-linen-kurti"), p({ id: "test-linen-kurti" }));
    expect((await json(res)).data.sku).toBe("MM-TST-1");
  });
});

describe("admin categories", () => {
  it("lists with product counts, creates, rejects duplicates", async () => {
    await create();
    const list = await json(await listCats(req("/api/v1/admin/categories"), p()));
    expect(list.data.find((c: { id: string }) => c.id === "kurtis").productCount).toBe(1);
    const body = { name: "Lehengas", slug: "lehengas", audience: "women", image: { url: IMG } };
    expect((await createCat(req("/api/v1/admin/categories", { method: "POST", body }), p())).status).toBe(201);
    expect((await createCat(req("/api/v1/admin/categories", { method: "POST", body }), p())).status).toBe(409);
    expect((await Category.findOne({ slug: "lehengas" }).lean())!.sortOrder).toBe(3);
  });

  it("updates visibility and reorders within the main category", async () => {
    expect((await patchCat(req("/api/v1/admin/categories/dresses", { method: "PATCH", body: { visible: false } }), p({ id: "dresses" }))).status).toBe(200);
    expect((await loadCatalogSnapshot()).categories.some((c) => c.id === "dresses")).toBe(false);
    const moved = await json(await moveCat(req("/api/v1/admin/categories/dresses/move", { method: "POST", body: { direction: -1 } }), p({ id: "dresses" })));
    const women = moved.data.filter((c: { audience: string }) => c.audience === "women").map((c: { id: string }) => c.id);
    expect(women).toEqual(["kurtis", "dresses", "ethnic-wear"]);
  });

  it("refuses to delete a category in use; deleting an unused one removes it from tags", async () => {
    await create();
    expect((await deleteCat(req("/api/v1/admin/categories/kurtis", { method: "DELETE" }), p({ id: "kurtis" }))).status).toBe(409);
    expect((await deleteCat(req("/api/v1/admin/categories/ethnic-wear", { method: "DELETE" }), p({ id: "ethnic-wear" }))).status).toBe(200);
    expect((await Product.findOne().lean())!.tags).toHaveLength(0);
  });

  it("staff can read but not change categories", async () => {
    expect((await listCats(req("/api/v1/admin/categories", { as: "staff" }), p())).status).toBe(200);
    expect((await patchCat(req("/api/v1/admin/categories/kurtis", { method: "PATCH", body: { visible: false }, as: "staff" }), p({ id: "kurtis" }))).status).toBe(403);
  });
});

describe("admin inventory", () => {
  const SKU = "MM-TST-1-M-IVORY";
  const adj = (body: Record<string, unknown>, as = "owner") => adjust(req("/api/v1/admin/inventory/adjust", { method: "POST", body, as }), p());

  it("lists one row per variant", async () => {
    await create();
    const rows = (await json(await listInv(req("/api/v1/admin/inventory"), p()))).data;
    expect(rows.map((r: { sku: string; stock: number }) => [r.sku, r.stock])).toEqual([[SKU, 5], ["MM-TST-1-L-IVORY", 3]]);
  });

  it("adds, removes and sets stock with ledger entries; staff (inventory:write) may adjust", async () => {
    const id = (await create()).body.data.id;
    expect((await json(await adj({ productId: id, variantSku: SKU, mode: "add", quantity: 10, reason: "Restock" }))).data.stock).toBe(15);
    expect((await json(await adj({ productId: id, variantSku: SKU, mode: "remove", quantity: 2, reason: "Damaged" }, "staff"))).data.stock).toBe(13);
    expect((await json(await adj({ productId: id, variantSku: SKU, mode: "set", quantity: 7, reason: "Correction" }))).data.stock).toBe(7);
    const ledger = await InventoryMovement.find({ variantSku: SKU }).sort({ createdAt: 1 }).lean();
    expect(ledger.map((m) => [m.type, m.stockChange, m.stockAfter])).toEqual([["restock", 5, 5], ["restock", 10, 15], ["damaged", -2, 13], ["correction", -6, 7]]);
    const recent = (await json(await movements(req("/api/v1/admin/inventory/movements?limit=2"), p()))).data;
    expect(recent[0]).toMatchObject({ sku: SKU, change: -6, reason: "Correction", stockAfter: 7, by: "owner" });
  });

  it("never lets stock fall below reserved units or below zero", async () => {
    const id = (await create()).body.data.id;
    await Product.updateOne({ _id: id, "variants.sku": SKU }, { $set: { "variants.$.reserved": 4 } });
    expect((await adj({ productId: id, variantSku: SKU, mode: "remove", quantity: 2, reason: "Damaged" })).status).toBe(409);
    expect((await adj({ productId: id, variantSku: SKU, mode: "set", quantity: 3, reason: "Correction" })).status).toBe(409);
    expect((await adj({ productId: id, variantSku: "MM-TST-1-L-IVORY", mode: "remove", quantity: 9, reason: "Damaged" })).status).toBe(400);
  });

  it("applies concurrent adjustments without losing any (transactions)", async () => {
    const id = (await create()).body.data.id;
    const results = await Promise.all(Array.from({ length: 8 }, () => adj({ productId: id, variantSku: SKU, mode: "add", quantity: 1, reason: "Restock" })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const v = (await Product.findById(id).lean())!.variants.find((x) => x.sku === SKU)!;
    expect(v.stock).toBe(13);
    expect(await InventoryMovement.countDocuments({ variantSku: SKU })).toBe(9);
  }, 30_000);

  it("updates inStock for the storefront when stock runs out", async () => {
    const id = (await create()).body.data.id;
    await adj({ productId: id, variantSku: SKU, mode: "set", quantity: 0, reason: "Correction" });
    await adj({ productId: id, variantSku: "MM-TST-1-L-IVORY", mode: "set", quantity: 0, reason: "Correction" });
    expect((await Product.findById(id).lean())!.inStock).toBe(false);
  });

  it("sets per-variant alert levels", async () => {
    const id = (await create()).body.data.id;
    const res = await threshold(req("/api/v1/admin/inventory/threshold", { method: "PATCH", body: { productId: id, variantSku: SKU, threshold: 4 } }), p());
    expect((await json(res)).data.lowStockThreshold).toBe(4);
  });
});

describe("Cloudinary uploads", () => {
  it("signs requests the way Cloudinary documents", () => {
    // Example from Cloudinary's "Generating authentication signatures" docs.
    expect(signParams({ eager: "w_400,h_300,c_pad|w_260,h_200,c_crop", public_id: "sample_image", timestamp: 1315060510 }, "abcd")).toBe(
      "bfd09f95f331f558cbd1320e67aa8d488770583e",
    );
  });

  it("only admins with uploads:write get a signature, and it never contains the API secret", async () => {
    expect((await signUpload(req("/api/v1/admin/uploads/sign", { method: "POST", body: { purpose: "product" }, as: "staff" }), p())).status).toBe(403);
    expect((await signUpload(req("/api/v1/admin/uploads/sign", { method: "POST", body: { purpose: "product" }, as: "none" }), p())).status).toBe(401);
    const res = await signUpload(req("/api/v1/admin/uploads/sign", { method: "POST", body: { purpose: "product", ref: "Test Linen Kurti!" } }), p());
    const out = await json(res);
    expect(res.status).toBe(200);
    expect(out.data.publicId).toMatch(/^mm-collections\/products\/test-linen-kurti\/[a-z0-9]+-[a-f0-9]{12}$/);
    expect(out.data.fields).toMatchObject({ allowed_formats: "jpg,png,webp,avif", overwrite: "false", api_key: "123456789012345" });
    expect(JSON.stringify(out)).not.toContain("test-secret-value");
    expect(await MediaAsset.countDocuments({ status: "signed" })).toBe(1);
  });

  function mockCloudinary(resource: Record<string, unknown>) {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/resources/image/upload/")) return Response.json(resource);
      if (url.endsWith("/image/destroy")) return Response.json({ result: "ok" });
      return new Response("{}", { status: 404 });
    });
    return calls;
  }

  it("confirms a valid upload using Cloudinary's own record of the file", async () => {
    const { publicId } = (await json(await signUpload(req("/api/v1/admin/uploads/sign", { method: "POST", body: { purpose: "category" } }), p()))).data;
    mockCloudinary({ public_id: publicId, format: "webp", bytes: 300_000, width: 1200, height: 1500, secure_url: `https://res.cloudinary.com/testcloud/image/upload/v1/${publicId}.webp` });
    const res = await confirmUpload(req("/api/v1/admin/uploads/confirm", { method: "POST", body: { publicId } }), p());
    expect(res.status).toBe(200);
    expect((await json(res)).data).toMatchObject({ width: 1200, format: "webp" });
    expect((await MediaAsset.findOne({ publicId }).lean())!.status).toBe("uploaded");
    // The audit entry must fit long Cloudinary IDs (regression: entity.id was capped at 64 chars).
    expect(await models.AuditLog.countDocuments({ action: "media.upload", "entity.id": publicId })).toBe(1);
  });

  it("deletes and rejects files over 5 MB or in the wrong format", async () => {
    for (const bad of [{ format: "png", bytes: 6 * 1024 * 1024 }, { format: "gif", bytes: 1000 }]) {
      const { publicId } = (await json(await signUpload(req("/api/v1/admin/uploads/sign", { method: "POST", body: { purpose: "product" } }), p()))).data;
      const calls = mockCloudinary({ public_id: publicId, width: 10, height: 10, secure_url: "https://res.cloudinary.com/testcloud/x", ...bad });
      const res = await confirmUpload(req("/api/v1/admin/uploads/confirm", { method: "POST", body: { publicId } }), p());
      expect(res.status).toBe(400);
      expect(calls.some((c) => c.endsWith("/image/destroy"))).toBe(true);
      expect((await MediaAsset.findOne({ publicId }).lean())!.status).toBe("deleted");
      vi.restoreAllMocks();
    }
  });

  it("refuses to confirm images that weren't signed by us", async () => {
    const res = await confirmUpload(req("/api/v1/admin/uploads/confirm", { method: "POST", body: { publicId: "mm-collections/products/x/forged" } }), p());
    expect(res.status).toBe(403);
  });

  it("accepts Cloudinary URLs only from our own cloud", async () => {
    const ours = "https://res.cloudinary.com/testcloud/image/upload/v1/mm-collections/products/a/b.webp";
    const theirs = "https://res.cloudinary.com/othercloud/image/upload/v1/x.webp";
    expect((await create({ images: [{ url: ours, publicId: "mm-collections/products/a/b" }] })).res.status).toBe(201);
    expect((await create({ slug: "other", sku: "MM-TST-5", images: [{ url: theirs }] })).res.status).toBe(400);
  });
});
