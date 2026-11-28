import "server-only";
import { isValidObjectId, type Model, type QueryFilter, type SortOrder, type Types } from "mongoose";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import { createCatalog, type CatalogSnapshot } from "@/lib/catalog-query";
import type { Category, Product } from "@/types";
import {
  CATEGORY_PUBLIC_PROJECTION,
  PRODUCT_PUBLIC_PROJECTION,
  toStoreCategory,
  toStoreProduct,
  type CategoryLean,
  type ProductLean,
} from "@/server/catalog/mapper";
import { connectToDatabase } from "@/server/db/connect";
import { notFound } from "@/server/http/errors";
import { paginationMeta } from "@/server/http/response";
import { Category as CategoryModel } from "@/server/models/category.model";
import { Product as ProductModel } from "@/server/models/product.model";
import type { ProductListQuery } from "@/server/validation/catalog";
import { skipFor } from "@/server/validation/common";

/** Cache tag for all public catalogue data — call revalidateTag(CATALOG_TAG) after admin edits. */
export const CATALOG_TAG = "catalog";

type RawDoc<M> = M extends Model<infer T> ? T : never;
type ProductFilter = QueryFilter<RawDoc<typeof ProductModel>>;

/** Only these products are ever visible to shoppers. */
const PUBLIC_PRODUCT = { status: "active", visible: true } as const;

type SlugIndex = { slugOf: (id: Types.ObjectId) => string | undefined; idOf: (slug: string) => Types.ObjectId | undefined };

function indexCategories(all: CategoryLean[]): SlugIndex {
  const slugById = new Map(all.map((c) => [c._id.toString(), c.slug]));
  const idBySlug = new Map(all.map((c) => [c.slug, c._id]));
  return { slugOf: (id) => slugById.get(id.toString()), idOf: (slug) => idBySlug.get(slug) };
}

async function allCategories() {
  return CategoryModel.find({}, { ...CATEGORY_PUBLIC_PROJECTION, visible: 1 })
    .sort({ sortOrder: 1 })
    .lean<(CategoryLean & { visible?: boolean })[]>();
}

/** Every visible category and active product, mapped to storefront shapes. Uncached. */
export async function loadCatalogSnapshot(): Promise<CatalogSnapshot> {
  await connectToDatabase();
  const [cats, prods] = await Promise.all([
    allCategories(),
    ProductModel.find(PUBLIC_PRODUCT, PRODUCT_PUBLIC_PROJECTION).sort({ publishedAt: 1, _id: 1 }).lean<ProductLean[]>(),
  ]);
  const { slugOf } = indexCategories(cats);
  return {
    categories: cats.filter((c) => c.visible !== false).map(toStoreCategory),
    products: prods.map((p) => toStoreProduct(p, slugOf)),
  };
}

/**
 * Cached snapshot for storefront pages. Refreshed every 5 minutes, or immediately when an admin
 * change calls revalidateTag(CATALOG_TAG). Stock shown here may lag slightly; checkout always
 * re-reads live stock from the database.
 */
export const getCatalogSnapshot = unstable_cache(loadCatalogSnapshot, ["catalog-snapshot-v2"], {
  tags: [CATALOG_TAG],
  revalidate: 300,
});

/** Per-request memoised catalogue for server components. */
export const getCatalog = cache(async () => createCatalog(await getCatalogSnapshot()));

/* ---------- API queries (straight from MongoDB, indexed + paginated) ---------- */

const SORTS: Record<NonNullable<ProductListQuery["sort"]>, Record<string, SortOrder | { $meta: "textScore" }>> = {
  // Sold-out items always sink to the end, matching the storefront.
  featured: { inStock: -1, featured: -1, soldCount: -1, _id: 1 },
  newest: { inStock: -1, newArrival: -1, publishedAt: -1, _id: 1 },
  "price-asc": { inStock: -1, pricePaise: 1, _id: 1 },
  "price-desc": { inStock: -1, pricePaise: -1, _id: 1 },
  "best-selling": { inStock: -1, soldCount: -1, _id: 1 },
  rating: { inStock: -1, "reviewStats.average": -1, "reviewStats.count": -1, _id: 1 },
  relevance: { score: { $meta: "textScore" }, inStock: -1, soldCount: -1 },
};

export async function listProducts(q: ProductListQuery) {
  await connectToDatabase();
  const cats = indexCategories(await allCategories());

  const filter: Record<string, unknown> = { ...PUBLIC_PRODUCT };
  if (q.audience) filter.audience = q.audience;
  if (q.category) {
    const id = cats.idOf(q.category);
    if (!id) return { items: [] as Product[], meta: paginationMeta(q.page, q.limit, 0) };
    filter.$or = [{ category: id }, { tags: id }];
  }
  if (q.q) filter.$text = { $search: q.q };
  if (q.minPrice !== undefined || q.maxPrice !== undefined) {
    filter.pricePaise = {
      ...(q.minPrice !== undefined && { $gte: q.minPrice * 100 }),
      ...(q.maxPrice !== undefined && { $lte: q.maxPrice * 100 }),
    };
  }
  if (q.minDiscount !== undefined) filter.discountPercent = { $gte: q.minDiscount };
  if (q.inStock) filter.inStock = true;
  if (q.featured !== undefined) filter.featured = q.featured;
  if (q.newArrival !== undefined) filter.newArrival = q.newArrival;
  if (q.bestSeller !== undefined) filter.bestSeller = q.bestSeller;
  if (q.sizes?.length) filter["variants.size"] = { $in: q.sizes };
  if (q.colors?.length) filter["variants.color.name"] = { $in: q.colors };

  const sortKey = q.sort ?? (q.q ? "relevance" : "featured");
  const sort = sortKey === "relevance" && !q.q ? SORTS.featured : SORTS[sortKey];
  // Listings skip the long description; text searches also return the relevance score.
  const { description: _omit, ...listFields } = PRODUCT_PUBLIC_PROJECTION;
  void _omit;
  const projection = sortKey === "relevance" && q.q ? { ...listFields, score: { $meta: "textScore" } } : listFields;

  const [docs, total] = await Promise.all([
    ProductModel.find(filter as ProductFilter, projection)
      .sort(sort as Record<string, SortOrder>)
      .skip(skipFor(q))
      .limit(q.limit)
      .lean<ProductLean[]>(),
    ProductModel.countDocuments(filter as ProductFilter),
  ]);

  return { items: docs.map((p) => toStoreProduct(p, cats.slugOf)), meta: paginationMeta(q.page, q.limit, total) };
}

/** Product by slug, original ID (p001) or database ID — read fresh from MongoDB. */
export async function getProductDetail(ref: string): Promise<{ product: Product; related: Product[] }> {
  await connectToDatabase();
  const or: Record<string, unknown>[] = [{ slug: ref.toLowerCase() }, { legacyId: ref }];
  if (isValidObjectId(ref)) or.push({ _id: ref });
  const [doc, cats] = await Promise.all([
    ProductModel.findOne({ ...PUBLIC_PRODUCT, $or: or } as ProductFilter, PRODUCT_PUBLIC_PROJECTION).lean<ProductLean>(),
    allCategories(),
  ]);
  if (!doc) throw notFound("Product not found.");
  const product = toStoreProduct(doc, indexCategories(cats).slugOf);
  const related = (await getCatalog()).getRelatedProducts(product, 4);
  return { product, related };
}

export async function listCategories(audience?: Category["audience"]) {
  const { categories } = await getCatalogSnapshot();
  return audience ? categories.filter((c) => c.audience === audience) : categories;
}

export async function getCategoryDetail(slug: string) {
  const catalog = await getCatalog();
  const category = catalog.getCategory(slug);
  if (!category) throw notFound("Category not found.");
  return { category, productCount: catalog.getProductsByCategory(category.id).length };
}

/**
 * Fresh (uncached) lookup for checkout pricing: only the products in the bag, straight from
 * MongoDB, so prices and stock are never stale. IDs may be original IDs (p001) or database IDs.
 */
export async function loadProductsForCheckout(ids: string[]): Promise<(id: string) => Product | undefined> {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id.length <= 64))].slice(0, 50);
  if (!unique.length) return () => undefined;
  await connectToDatabase();
  const objectIds = unique.filter((id) => isValidObjectId(id));
  const [docs, cats] = await Promise.all([
    ProductModel.find(
      { ...PUBLIC_PRODUCT, $or: [{ legacyId: { $in: unique } }, { _id: { $in: objectIds } }] } as ProductFilter,
      PRODUCT_PUBLIC_PROJECTION,
    ).lean<ProductLean[]>(),
    allCategories(),
  ]);
  const { slugOf } = indexCategories(cats);
  const byId = new Map<string, Product>();
  for (const doc of docs) {
    const p = toStoreProduct(doc, slugOf);
    byId.set(p.id, p);
    byId.set(doc._id.toString(), p);
  }
  return (id) => byId.get(id);
}
