import "server-only";
import type { Types } from "mongoose";
import type { Audience, Category, CategoryId, Product, ProductColor, Size } from "@/types";

/**
 * MongoDB documents → the storefront's existing `Product` / `Category` shapes, so components
 * don't change. Prices become whole rupees for display; all arithmetic on the server stays in paise.
 */

interface VariantLean {
  sku: string;
  size?: string | null;
  color?: { name: string; hex?: string | null } | null;
  pricePaise: number;
  mrpPaise: number;
  stock: number;
  reserved: number;
  isActive?: boolean | null;
}

export interface ProductLean {
  _id: Types.ObjectId;
  legacyId?: string | null;
  slug: string;
  name: string;
  sku: string;
  audience: string;
  category: Types.ObjectId;
  tags?: Types.ObjectId[];
  shortDescription?: string | null;
  description?: string | null;
  images?: { url: string }[];
  variants: VariantLean[];
  fabric?: string | null;
  care?: string[];
  featured?: boolean | null;
  newArrival?: boolean | null;
  bestSeller?: boolean | null;
  reviewStats?: { average?: number | null; count?: number | null } | null;
  colorImages?: { color: string; images?: { url: string }[] | null }[] | null;
  soldCount?: number | null;
  shipping?: { weightGrams?: number | null; lengthCm?: number | null; widthCm?: number | null; heightCm?: number | null } | null;
  publishedAt?: Date | null;
  createdAt?: Date;
}

export interface CategoryLean {
  _id: Types.ObjectId;
  slug: string;
  audience: string;
  name: string;
  description?: string | null;
  image?: { url: string } | null;
}

/** Fields the storefront needs — keeps list queries light. */
export const PRODUCT_PUBLIC_PROJECTION = {
  legacyId: 1, slug: 1, name: 1, sku: 1, audience: 1, category: 1, tags: 1, shortDescription: 1, description: 1,
  images: 1, variants: 1, fabric: 1, care: 1, featured: 1, newArrival: 1, bestSeller: 1, reviewStats: 1, colorImages: 1, soldCount: 1,
  shipping: 1, publishedAt: 1, createdAt: 1,
} as const;

export const CATEGORY_PUBLIC_PROJECTION = { slug: 1, audience: 1, name: 1, description: 1, image: 1, sortOrder: 1 } as const;

/** The public product ID: the original catalogue ID when there is one, so saved carts keep working. */
export const publicProductId = (p: Pick<ProductLean, "_id" | "legacyId">) => p.legacyId || p._id.toString();

const toRupees = (paise: number) => Math.round(paise) / 100;

export function toStoreCategory(c: CategoryLean): Category {
  return {
    id: c.slug as CategoryId,
    slug: c.slug as CategoryId,
    audience: c.audience as Audience,
    name: c.name,
    description: c.description ?? "",
    image: c.image?.url ?? "",
  };
}

export function toStoreProduct(p: ProductLean, slugOf: (id: Types.ObjectId) => string | undefined): Product {
  const active = p.variants.filter((v) => v.isActive !== false);
  const sizes: Size[] = [];
  const colors: ProductColor[] = [];
  for (const v of active) {
    if (v.size && !sizes.includes(v.size as Size)) sizes.push(v.size as Size);
    if (v.color && !colors.some((c) => c.name === v.color!.name)) colors.push({ name: v.color.name, hex: v.color.hex ?? "#CCCCCC" });
  }
  const price = active.length ? Math.min(...active.map((v) => v.pricePaise)) : 0;
  const mrp = active.length ? Math.max(...active.map((v) => v.mrpPaise)) : 0;
  const stock = active.reduce((n, v) => n + Math.max(0, v.stock - v.reserved), 0);
  const weight = p.shipping?.weightGrams ?? 0;

  return {
    id: publicProductId(p),
    slug: p.slug,
    sku: p.sku,
    name: p.name,
    audienceCategory: p.audience as Audience,
    categoryId: (slugOf(p.category) ?? "") as CategoryId,
    tags: (p.tags ?? []).map(slugOf).filter(Boolean) as CategoryId[],
    shortDescription: p.shortDescription ?? "",
    description: p.description ?? "",
    originalPrice: toRupees(mrp),
    price: toRupees(price),
    discount: mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0,
    images: (p.images ?? []).map((i) => i.url),
    // Only colours on sale, listed under the name the picker uses.
    colorImages: colors.flatMap((c) => {
      const own = p.colorImages?.find((g) => g.color.trim().toLowerCase() === c.name.trim().toLowerCase());
      return own?.images?.length ? [{ color: c.name, images: own.images.map((i) => i.url) }] : [];
    }),
    sizes,
    colors,
    stock,
    variants: active.map((v) => ({ size: (v.size || null) as Size | null, color: v.color?.name ?? null, stock: Math.max(0, v.stock - v.reserved) })),
    rating: p.reviewStats?.average ?? 0,
    reviewCount: p.reviewStats?.count ?? 0,
    featured: !!p.featured,
    newArrival: !!p.newArrival,
    bestSeller: !!p.bestSeller,
    fabric: p.fabric ?? "",
    care: p.care ?? [],
    addedAt: (p.publishedAt ?? p.createdAt ?? new Date(0)).getTime(),
    sold: p.soldCount ?? 0,
    weight,
    weightUnit: "g",
    packageLength: p.shipping?.lengthCm ?? 0,
    packageWidth: p.shipping?.widthCm ?? 0,
    packageHeight: p.shipping?.heightCm ?? 0,
  };
}
