import "server-only";
import { z } from "zod";
import { AUDIENCES } from "@/server/models/_shared";
import { pagination, queryBoolean, slug } from "./common";

const list = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v : v.split(",")).map((s) => s.trim()).filter(Boolean).slice(0, 30));

const rupees = z.coerce.number().int().min(0).max(10_000_000);

export const PRODUCT_SORTS = ["featured", "newest", "price-asc", "price-desc", "best-selling", "rating", "relevance"] as const;

/** GET /api/v1/products — prices are whole rupees in the query string. */
export const productListQuery = pagination.extend({
  q: z.string().trim().min(2).max(100).optional(),
  audience: z.enum(AUDIENCES).optional(),
  category: slug.optional(),
  minPrice: rupees.optional(),
  maxPrice: rupees.optional(),
  minDiscount: z.coerce.number().int().min(0).max(100).optional(),
  inStock: queryBoolean.optional(),
  featured: queryBoolean.optional(),
  newArrival: queryBoolean.optional(),
  bestSeller: queryBoolean.optional(),
  sizes: list.optional(),
  colors: list.optional(),
  sort: z.enum(PRODUCT_SORTS).optional(),
});

export type ProductListQuery = z.output<typeof productListQuery>;

export const categoryListQuery = z.object({ audience: z.enum(AUDIENCES).optional() });

/** A product can be addressed by slug, original catalogue ID (p001) or database ID. */
export const productRef = z.object({ ref: z.string().trim().min(1).max(160).regex(/^[a-zA-Z0-9-]+$/) });

export const categoryRef = z.object({ slug });
