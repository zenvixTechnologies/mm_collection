import { MongoMemoryServer } from "mongodb-memory-server";
import type { Types } from "mongoose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { categories } from "@/data/categories";
import { products as legacyProducts } from "@/data/products";
import { resetEnvCache } from "@/server/config/env";
import { connectToDatabase, disconnectFromDatabase } from "@/server/db/connect";
import { publishedAtFor, toProductDoc } from "@/server/catalog/legacy-import";
import { Category, Product } from "@/server/models";
import { productListQuery } from "@/server/validation/catalog";
import { getCategoryDetail, getProductDetail, listProducts, loadCatalogSnapshot } from "./catalog.service";

// unstable_cache needs the Next.js runtime; in tests it is a pass-through.
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn() }));

let mongo: MongoMemoryServer;
const q = (input: Record<string, unknown> = {}) => productListQuery.parse(input);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  vi.stubEnv("MONGODB_URI", mongo.getUri());
  vi.stubEnv("MONGODB_DB_NAME", "mm-catalog-test");
  resetEnvCache();
  await connectToDatabase();
  await Product.syncIndexes(); // text index
  const cats = await Category.insertMany(categories.map((c, i) => ({ slug: c.slug, audience: c.audience, name: c.name, description: c.description, image: { url: c.image }, sortOrder: i })));
  const ids = new Map<string, Types.ObjectId>(cats.map((c) => [c.slug, c._id]));
  const anchor = new Date("2026-11-01T00:00:00Z");
  for (const [i, p] of legacyProducts.entries()) {
    await Product.create(toProductDoc(p, (s) => ids.get(s)!, publishedAtFor(i, legacyProducts.length, anchor)));
  }
  // The original catalogue has no Home & Living products yet — add a bedsheet to cover bed sizes.
  await Product.create({
    slug: 'test-cotton-bedsheet', name: 'Test Cotton Bedsheet', sku: 'MM-HBS-9001', audience: 'home-living',
    category: ids.get('home-bedsheets')!, pricePaise: 0, mrpPaise: 0, status: 'active',
    variants: [
      { sku: 'MM-HBS-9001-KING', size: 'King', pricePaise: 149900, mrpPaise: 199900, stock: 4 },
      { sku: 'MM-HBS-9001-QUEEN', size: 'Queen', pricePaise: 129900, mrpPaise: 179900, stock: 0 },
    ],
  });
  // A draft product must never reach the storefront.
  await Product.updateOne({ legacyId: legacyProducts[0].id }, { status: "draft" });
}, 180_000);

afterAll(async () => {
  await disconnectFromDatabase();
  await mongo?.stop();
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("loadCatalogSnapshot", () => {
  it("round-trips the original catalogue unchanged (except drafts)", async () => {
    const snap = await loadCatalogSnapshot();
    expect(snap.categories).toHaveLength(categories.length);
    expect(snap.products).toHaveLength(legacyProducts.length); // −1 draft +1 bedsheet
    expect(snap.products.some((p) => p.id === legacyProducts[0].id)).toBe(false);

    for (const original of legacyProducts.slice(1)) {
      const p = snap.products.find((x) => x.id === original.id)!;
      expect(p, original.id).toBeDefined();
      expect({ slug: p.slug, price: p.price, originalPrice: p.originalPrice, discount: p.discount, stock: p.stock }).toEqual({
        slug: original.slug,
        price: original.price,
        originalPrice: original.originalPrice,
        discount: original.discount,
        stock: original.stock,
      });
      expect(p.sizes).toEqual(original.sizes);
      expect(p.colors.map((c) => c.name)).toEqual(original.colors.map((c) => c.name));
      expect(p.categoryId).toBe(original.categoryId);
      expect(p.tags).toEqual(original.tags);
      expect(p.images).toEqual(original.images);
    }
    // List order (oldest → newest) is preserved for "Newest" sorting.
    const order = snap.products.filter((p) => p.audienceCategory !== 'home-living').map((p) => p.id);
    expect(order).toEqual(legacyProducts.slice(1).map((p) => p.id));
  });
});

describe("listProducts", () => {
  it("paginates", async () => {
    const page1 = await listProducts(q({ limit: "10" }));
    const page2 = await listProducts(q({ limit: "10", page: "2" }));
    expect(page1.items).toHaveLength(10);
    expect(page1.meta.total).toBe(legacyProducts.length);
    expect(page1.items.map((p) => p.id)).not.toEqual(expect.arrayContaining(page2.items.map((p) => p.id)));
  });

  it("filters by category including tagged products, and by audience", async () => {
    const { items } = await listProducts(q({ category: "ethnic-wear", limit: "100" }));
    const expected = legacyProducts.slice(1).filter((p) => p.categoryId === "ethnic-wear" || p.tags.includes("ethnic-wear" as never));
    expect(items.map((p) => p.id).sort()).toEqual(expected.map((p) => p.id).sort());
    const home = await listProducts(q({ audience: "home-living", limit: "100" }));
    expect(home.items.every((p) => p.audienceCategory === "home-living")).toBe(true);
    expect(home.items.length).toBeGreaterThan(0);
  });

  it("filters by price (rupees) and sorts by price with sold-out last", async () => {
    const { items } = await listProducts(q({ minPrice: "1000", maxPrice: "2000", sort: "price-asc", limit: "100" }));
    expect(items.every((p) => p.price >= 1000 && p.price <= 2000)).toBe(true);
    const inStock = items.filter((p) => p.stock > 0).map((p) => p.price);
    expect(inStock).toEqual([...inStock].sort((a, b) => a - b));
    const firstSoldOut = items.findIndex((p) => p.stock === 0);
    if (firstSoldOut >= 0) expect(items.slice(firstSoldOut).every((p) => p.stock === 0)).toBe(true);
  });

  it("filters by size, colour and stock", async () => {
    const { items } = await listProducts(q({ sizes: "King,Queen", inStock: "true", limit: "100" }));
    expect(items.map((p) => p.slug)).toEqual(["test-cotton-bedsheet"]);
    // Summary computed from variants: lowest price, highest MRP, only available units counted.
    expect(items[0]).toMatchObject({ price: 1299, originalPrice: 1999, stock: 4, sizes: ["King", "Queen"], colors: [] });
    const ivory = await listProducts(q({ colors: "Ivory", sizes: "M", limit: "100" }));
    expect(ivory.items.length).toBeGreaterThan(0);
    expect(ivory.items.every((p) => p.colors.some((c) => c.name === "Ivory") && p.sizes.includes("M"))).toBe(true);
  });

  it("searches by text", async () => {
    const { items } = await listProducts(q({ q: "kurti" }));
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].name.toLowerCase()).toContain("kurti");
  });

  it("returns nothing for an unknown category", async () => {
    const { items, meta } = await listProducts(q({ category: "no-such-category" }));
    expect(items).toEqual([]);
    expect(meta.total).toBe(0);
  });
});

describe("details", () => {
  it("finds a product by slug or original ID, with same-audience related products", async () => {
    const original = legacyProducts[5];
    const bySlug = await getProductDetail(original.slug);
    const byId = await getProductDetail(original.id);
    expect(bySlug.product.id).toBe(original.id);
    expect(byId.product.slug).toBe(original.slug);
    expect(bySlug.related.every((r) => r.audienceCategory === original.audienceCategory && r.id !== original.id)).toBe(true);
  });

  it("hides drafts and unknown products", async () => {
    await expect(getProductDetail(legacyProducts[0].slug)).rejects.toMatchObject({ status: 404 });
    await expect(getProductDetail("nope")).rejects.toMatchObject({ status: 404 });
  });

  it("returns a category with its product count", async () => {
    const { category, productCount } = await getCategoryDetail("home-bedsheets");
    expect(category.name).toBe("Bedsheets");
    expect(productCount).toBeGreaterThan(0);
    await expect(getCategoryDetail("nope")).rejects.toMatchObject({ status: 404 });
  });
});
