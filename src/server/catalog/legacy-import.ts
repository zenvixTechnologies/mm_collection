import "server-only";
import type { Product as LegacyProduct, ProductColor } from "@/types";

/**
 * Converts the original frontend catalogue (src/data) into database documents.
 * Pure functions — used by the seed script and covered by tests.
 */

/** "16 × 16 in" → "1616IN", "Blush Pink" → "BLUSHPINK", "0-6M" → "06M". */
export function skuCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

export interface SeedVariant {
  sku: string;
  size: string | null;
  color: ProductColor | null;
  pricePaise: number;
  mrpPaise: number;
  stock: number;
  reserved: number;
  lowStockThreshold: number;
  isActive: boolean;
}

/**
 * One variant per size × colour. The old catalogue tracked a single stock number per product,
 * so it is split as evenly as possible across variants (the total is preserved exactly).
 */
export function buildVariants(p: LegacyProduct): SeedVariant[] {
  const sizes: (string | null)[] = p.sizes.length ? p.sizes : [null];
  const colors: (ProductColor | null)[] = p.colors.length ? p.colors : [null];
  const combos = sizes.flatMap((size) => colors.map((color) => ({ size, color })));
  const base = Math.floor(p.stock / combos.length);
  const remainder = p.stock % combos.length;

  return combos.map(({ size, color }, i) => ({
    sku: [p.sku, size && skuCode(size), color && skuCode(color.name)].filter(Boolean).join("-"),
    size,
    color: color ? { name: color.name, hex: color.hex } : null,
    pricePaise: Math.round(p.price * 100),
    mrpPaise: Math.round(Math.max(p.originalPrice, p.price) * 100),
    stock: base + (i < remainder ? 1 : 0),
    reserved: 0,
    lowStockThreshold: 2,
    isActive: true,
  }));
}

/**
 * The old catalogue ordered "newest" by list position. Spread publish dates an hour apart,
 * ending at `anchor`, so the same order survives the migration.
 */
export function publishedAtFor(index: number, total: number, anchor: Date) {
  return new Date(anchor.getTime() - (total - 1 - index) * 60 * 60 * 1000);
}

/** A full Product document for one legacy product. `catId` resolves a category slug to its ObjectId. */
export function toProductDoc<Id>(p: LegacyProduct, catId: (slug: string) => Id, publishedAt: Date) {
  const variants = buildVariants(p);
  return {
    legacyId: p.id,
    slug: p.slug,
    name: p.name,
    sku: p.sku,
    audience: p.audienceCategory,
    category: catId(p.categoryId),
    tags: p.tags.map(catId),
    shortDescription: p.shortDescription,
    description: p.description,
    images: p.images.map((url) => ({ url, alt: p.name })),
    variants,
    fabric: p.fabric,
    care: p.care,
    // Summary fields are recomputed from variants by the model's validate hook.
    pricePaise: Math.min(...variants.map((v) => v.pricePaise)),
    mrpPaise: Math.max(...variants.map((v) => v.mrpPaise)),
    status: "active" as const,
    visible: true,
    featured: p.featured,
    newArrival: p.newArrival,
    bestSeller: p.bestSeller,
    rating: { average: p.rating, count: p.reviewCount },
    soldCount: p.sold,
    shipping: { weightGrams: p.weight, lengthCm: p.packageLength, widthCm: p.packageWidth, heightCm: p.packageHeight },
    publishedAt,
  };
}
