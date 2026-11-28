import { MongoMemoryServer } from "mongodb-memory-server";
import type { Types } from "mongoose";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/v1/products/route";
import { categories } from "@/data/categories";
import { products as legacyProducts } from "@/data/products";
import { searchProducts, sortProducts, type SortValue } from "@/lib/catalog";
import { listingQuery, parseListing, withPage, type ListingScope } from "@/lib/listing";
import { publishedAtFor, toProductDoc } from "@/server/catalog/legacy-import";
import { resetEnvCache } from "@/server/config/env";
import { connectToDatabase, disconnectFromDatabase } from "@/server/db/connect";
import { Category, Product } from "@/server/models";
import { productListQuery } from "@/server/validation/catalog";
import { listProducts, loadCatalogSnapshot } from "./catalog.service";

// unstable_cache needs the Next.js runtime; in tests it is a pass-through.
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn() }));

let mongo: MongoMemoryServer;
const ids = new Map<string, Types.ObjectId>();
const q = (input: Record<string, unknown> = {}) => productListQuery.parse({ limit: "100", ...input });
const slugs = async (input: Record<string, unknown>) => (await listProducts(q(input))).items.map((p) => p.slug).sort();

type V = [size: string | null, color: string | null, stock: number, extra?: { reserved?: number; isActive?: boolean }];

/** A fixture in the "fx" set (featured=false, bestSeller & newArrival flags unused by the others). */
async function fixture(slug: string, variants: V[], extra: Record<string, unknown> = {}) {
  const sku = `FX-${slug.toUpperCase()}`;
  await Product.create({
    slug: `fx-${slug}`,
    name: `Zzfixture ${slug}`,
    sku,
    audience: "home-living",
    category: ids.get("home-bedsheets")!,
    pricePaise: 0,
    mrpPaise: 0,
    status: "active",
    publishedAt: new Date("2026-10-01T00:00:00Z"),
    variants: variants.map(([size, color, stock, more], i) => ({
      sku: `${sku}-${i}`,
      ...(size && { size }),
      ...(color && { color: { name: color, hex: "#111111" } }),
      pricePaise: 100000,
      mrpPaise: 100000,
      stock,
      ...more,
    })),
    ...extra,
  });
}

const FX = { audience: "home-living" };

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  vi.stubEnv("MONGODB_URI", mongo.getUri());
  vi.stubEnv("MONGODB_DB_NAME", "mm-listing-test");
  resetEnvCache();
  await connectToDatabase();
  await Product.syncIndexes();
  const cats = await Category.insertMany(
    categories.map((c, i) => ({ slug: c.slug, audience: c.audience, name: c.name, description: c.description, image: { url: c.image }, sortOrder: i })),
  );
  cats.forEach((c) => ids.set(c.slug, c._id));
  const anchor = new Date("2026-11-01T00:00:00Z");
  for (const [i, p] of legacyProducts.entries()) {
    await Product.create(toProductDoc(p, (s) => ids.get(s)!, publishedAtFor(i, legacyProducts.length, anchor)));
  }

  // The task's example: S 5, M 3, L 0.
  await fixture("a", [["S", "Zzred", 5], ["M", "Zzred", 3], ["L", "Zzred", 0]]);
  // L exists but every unit is held by unpaid checkouts.
  await fixture("reserved", [["L", "Zzred", 2, { reserved: 2 }], ["S", "Zzred", 1]]);
  // One L is still free after reservations.
  await fixture("part", [["L", "Zzred", 3, { reserved: 2 }]]);
  // L is switched off, although it has stock.
  await fixture("inactive", [["L", "Zzred", 9, { isActive: false }], ["S", "Zzred", 1]]);
  // Black and M both exist and are in stock — never on the same variant.
  await fixture("split", [["M", "Zzwhite", 4], ["S", "Zzblack", 4]]);
  // Black M exists but is sold out; white M and black S have stock.
  await fixture("split-soldout", [["M", "Zzblack", 0], ["M", "Zzwhite", 4], ["S", "Zzblack", 4]]);
  await fixture("black-m", [["M", "Zzblack", 1]]);
  await fixture("sold-out", [["XXL", "Zzgone", 0]]);
  await fixture("colour-only", [[null, "Zzplain", 2]], { category: ids.get("home-blankets")! });
}, 180_000);

afterAll(async () => {
  await disconnectFromDatabase();
  await mongo?.stop();
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("size and colour use the available stock of one variant", () => {
  it("matches a size only when one of its variants has units to sell", async () => {
    expect(await slugs({ ...FX, sizes: "L" })).toEqual(["fx-part"]);
    expect(await slugs({ ...FX, sizes: "M" })).toEqual(["fx-a", "fx-black-m", "fx-split", "fx-split-soldout"]);
  });

  it("OR-s several sizes", async () => {
    expect(await slugs({ ...FX, sizes: "L,XXL" })).toEqual(["fx-part"]);
    expect(await slugs({ ...FX, sizes: "L,S" })).toEqual(["fx-a", "fx-inactive", "fx-part", "fx-reserved", "fx-split", "fx-split-soldout"]);
  });

  it("requires size and colour on the same variant", async () => {
    expect(await slugs({ ...FX, sizes: "M", colors: "Zzblack" })).toEqual(["fx-black-m"]);
    expect(await slugs({ ...FX, sizes: "S", colors: "Zzblack" })).toEqual(["fx-split", "fx-split-soldout"]);
  });

  it("matches colours only with stock, including products without sizes", async () => {
    expect(await slugs({ ...FX, colors: "Zzgone" })).toEqual([]);
    expect(await slugs({ ...FX, colors: "Zzplain,Zzgone" })).toEqual(["fx-colour-only"]);
  });

  it("follows a reservation and its release", async () => {
    const doc = await Product.findOne({ slug: "fx-part" }).orFail();
    doc.variants[0].reserved = 3;
    await doc.save();
    expect(await slugs({ ...FX, sizes: "L" })).toEqual([]);
    expect(await slugs({ ...FX, inStock: "true" })).not.toContain("fx-part");
    doc.variants[0].reserved = 2;
    await doc.save();
    expect(await slugs({ ...FX, sizes: "L" })).toEqual(["fx-part"]);
  });

  it("keeps sold-out products listed (last) until stock is asked for", async () => {
    const all = (await listProducts(q(FX))).items;
    expect(all.at(-1)!.slug).toBe("fx-sold-out");
    expect(await slugs({ ...FX, inStock: "true" })).not.toContain("fx-sold-out");
  });
});

describe("combined filters, pagination and safety", () => {
  it("accepts several categories and AND-s them with the other filters", async () => {
    expect(await slugs({ category: "home-blankets" })).toEqual(["fx-colour-only"]);
    expect((await slugs({ category: "home-blankets,home-bedsheets" })).length).toBe(9);
    expect(await slugs({ category: "home-blankets,home-bedsheets", colors: "Zzblack", sizes: "M" })).toEqual(["fx-black-m"]);
    // Unknown slugs add nothing; only unknown slugs match nothing.
    expect(await slugs({ category: "home-blankets,no-such" })).toEqual(["fx-colour-only"]);
    expect(await slugs({ category: "no-such" })).toEqual([]);
  });

  it("counts every match and returns only the asked page", async () => {
    const one = await listProducts(q({ ...FX, sizes: "M", limit: "3" }));
    const two = await listProducts(q({ ...FX, sizes: "M", limit: "3", page: "2" }));
    expect(one.meta).toEqual({ page: 1, limit: 3, total: 4, totalPages: 2 });
    expect(one.items).toHaveLength(3);
    expect(two.items).toHaveLength(1);
    expect(new Set([...one.items, ...two.items].map((p) => p.id)).size).toBe(4);
  });

  it("treats query operators and field paths as plain text", async () => {
    expect(await slugs({ ...FX, sizes: "$variants.size" })).toEqual([]);
    expect(await slugs({ ...FX, colors: "$variants.color.name" })).toEqual([]);
    expect(await slugs({ ...FX, colors: "$$v.color.name" })).toEqual([]);
    // Regular-expression characters are dropped from a search.
    expect((await slugs({ ...FX, search: ".*(a+)+$" })).length).toBe(9);
    expect(await slugs({ ...FX, search: "zzfixture .*" })).toHaveLength(9);
  });

  it("rejects malformed input", () => {
    const bad: Record<string, unknown>[] = [
      { audience: "everyone" },
      { category: "a b" },
      { category: "{$ne:1}" },
      { minPrice: "-1" },
      { maxPrice: "abc" },
      { inStock: "yes" },
      { facets: "maybe" },
      { sort: "price_asc" },
      { page: "0" },
      { limit: "101" },
      { search: "x".repeat(101) },
      { minPrice: { $gt: "0" } },
    ];
    for (const input of bad) expect(productListQuery.safeParse(input).success, JSON.stringify(input)).toBe(false);
  });
});

describe("filter options", () => {
  it("lists only sizes and colours that have stock, and counts audiences and sub-categories", async () => {
    const { facets } = await listProducts(q({ ...FX, facets: "true", limit: "1" }));
    expect(facets!.sizes.sort()).toEqual(["L", "M", "S"]);
    expect(facets!.colors.map((c) => c.name).sort()).toEqual(["Zzblack", "Zzplain", "Zzred", "Zzwhite"]);
    expect(facets!.categories.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: "home-bedsheets", count: 8 },
      { id: "home-blankets", count: 1 },
    ]);
    expect(facets!.audiences.map((a) => a.id)).toEqual(["women", "men", "kids", "home-living"]);
    expect(facets!.price).toEqual({ min: 1000, max: 1000 });
  });

  it("narrows sizes, colours and prices to the chosen categories, but not the category list", async () => {
    const { facets } = await listProducts(q({ ...FX, category: "home-blankets", facets: "true" }));
    expect(facets!.sizes).toEqual([]);
    expect(facets!.colors).toEqual([{ name: "Zzplain", hex: "#111111" }]);
    expect(facets!.categories).toHaveLength(2);
  });

  it("keeps options while other filters are applied, even with no results", async () => {
    const { items, facets } = await listProducts(q({ ...FX, minPrice: "999999", facets: "true" }));
    expect(items).toEqual([]);
    expect(facets!.sizes).toContain("M");
  });

  it("is only computed on request", async () => {
    expect((await listProducts(q(FX))).facets).toBeUndefined();
  });

  it("matches the option lists the storefront used to build from every product", async () => {
    const snap = await loadCatalogSnapshot();
    for (const audience of ["women", "men", "kids"] as const) {
      const here = snap.products.filter((p) => p.audienceCategory === audience);
      const { facets, meta } = await listProducts(q({ audience, facets: "true", limit: "1" }));
      expect(meta.total).toBe(here.length);
      const buyable = here.flatMap((p) => p.variants!.filter((v) => v.stock > 0));
      expect(facets!.sizes.sort()).toEqual([...new Set(buyable.flatMap((v) => v.size ?? []))].sort());
      expect(facets!.colors.map((c) => c.name).sort()).toEqual([...new Set(buyable.flatMap((v) => v.color ?? []))].sort());
      for (const { id, count } of facets!.categories) {
        expect(count, id).toBe(here.filter((p) => p.categoryId === id || p.tags.includes(id as never)).length);
      }
      expect(facets!.price).toEqual({ min: Math.min(...here.map((p) => p.price)), max: Math.max(...here.map((p) => p.price)) });
    }
  });
});

describe("parity with the old in-browser search and sorting", () => {
  it("search finds the same products", async () => {
    const snap = await loadCatalogSnapshot();
    const searches = [
      "kurti", "kurtis", "dresses", "men's shirt", "women ethnic", "kids frock", "baby", "ladies saree", "cotton",
      "blue", "wine dress", "mm", "party gown", "jeans", "ethnic wear", "bedding", "zzfixture", "nothingmatches",
    ];
    for (const search of searches) {
      const expected = searchProducts(search, snap.products, snap.categories).map((p) => p.slug).sort();
      expect(await slugs({ search }), search).toEqual(expected);
    }
  });

  it("every sort orders as before, with sold-out products last", async () => {
    const snap = await loadCatalogSnapshot();
    const keys: Record<SortValue, (p: (typeof snap.products)[number]) => unknown[]> = {
      featured: (p) => [p.stock > 0, p.featured, p.sold],
      newest: (p) => [p.stock > 0, p.newArrival, p.addedAt],
      "price-asc": (p) => [p.stock > 0, p.price],
      "price-desc": (p) => [p.stock > 0, p.price],
      "best-selling": (p) => [p.stock > 0, p.sold],
      rating: (p) => [p.stock > 0, p.rating, p.reviewCount],
    };
    for (const sort of Object.keys(keys) as SortValue[]) {
      const got: typeof snap.products = [];
      for (let page = 1; page <= 20; page++) {
        const res = await listProducts(q({ sort, limit: "12", page: String(page) }));
        got.push(...res.items);
        if (page >= res.meta.totalPages) break;
      }
      expect(new Set(got.map((p) => p.id)).size, sort).toBe(snap.products.length);
      // Compare the sort keys, not IDs: products with equal keys may swap places.
      expect(got.map(keys[sort]), sort).toEqual(sortProducts(snap.products, sort).map(keys[sort]));
    }
  });
});

describe("GET /api/v1/products", () => {
  const get = async (query: string) => {
    const res = await GET(new NextRequest(`http://localhost/api/v1/products?${query}`), { params: Promise.resolve({}) });
    return { res, body: await res.json() };
  };

  it("keeps its shape for existing consumers and caches briefly", async () => {
    const { res, body } = await get("limit=2");
    expect(res.status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toEqual({ pagination: expect.objectContaining({ page: 1, limit: 2 }) });
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=30, stale-while-revalidate=30");
  });

  it("returns applied and available filters on request", async () => {
    const { body } = await get("audience=home-living&sizes=M&colors=Zzblack&facets=true");
    expect(body.data.map((p: { slug: string }) => p.slug)).toEqual(["fx-black-m"]);
    expect(body.meta.filters.applied).toEqual({ audience: "home-living", sizes: ["M"], colors: ["Zzblack"] });
    expect(body.meta.filters.available.sizes).toContain("L");
  });

  it("answers 400 to invalid values without leaking details", async () => {
    for (const query of ["sort=hack", "minPrice[$gt]=0&minPrice=x", "audience=women&audience=men", "limit=100000"]) {
      const { res, body } = await get(query);
      expect(res.status, query).toBe(400);
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    }
  });
});

describe("listing URLs", () => {
  const shop: ListingScope = { defaultSort: "featured" };
  const cats = categories.map((c) => ({ id: c.id, audience: c.audience }));
  const parse = (query: string, scope = shop) => parseListing(new URLSearchParams(query), scope, cats);

  it("always builds a request the API accepts, whatever the URL says", () => {
    const state = parse(
      "for=nobody&category=bad slug,<x>&sizes=M,HUGE&minPrice=-4&maxPrice=1e9&minDiscount=500&sort=drop&page=abc&search=a",
    );
    expect(state).toMatchObject({ search: "", sort: "featured", page: 1 });
    expect(state.filters).toMatchObject({ audiences: [], categories: [], sizes: ["M"], minPrice: null, maxPrice: null, minDiscount: null });
    const request = Object.fromEntries(new URLSearchParams(withPage(listingQuery(state, shop), 1, 12, true)));
    expect(productListQuery.safeParse(request).success).toBe(true);
  });

  it("ignores categories outside the page's or the chosen audience", () => {
    expect(parse("category=men-shirts", { audience: "women", defaultSort: "featured" }).filters.categories).toEqual([]);
    expect(parse("for=men&category=men-shirts,women-dresses").filters.categories).toEqual(["men-shirts"]);
  });

  it("locks a sub-category page to its category", () => {
    const scope: ListingScope = { audience: "men", category: "men-shirts", defaultSort: "featured" };
    const state = parse("category=men-jeans&for=women", scope);
    expect(listingQuery(state, scope)).toBe("audience=men&category=men-shirts&sort=featured");
  });
});
