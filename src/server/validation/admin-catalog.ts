import "server-only";
import { z } from "zod";
import { imageInput } from "@/server/catalog/images";
import { AUDIENCES } from "@/server/models/_shared";
import { paise, pagination, queryBoolean, slug } from "./common";

const text = (max: number) => z.string().trim().max(max);
const sku = z.string().trim().toUpperCase().min(2).max(64).regex(/^[A-Z0-9][A-Z0-9-]*$/, "Use letters, numbers and hyphens only.");

/** A product or category reference: original ID (p001), slug, or database ID. */
export const refParam = z.object({ id: z.string().trim().min(1).max(160).regex(/^[a-zA-Z0-9-]+$/) });

const colorInput = z.object({
  name: z.string().trim().min(1).max(40),
  hex: z.string().regex(/^#[0-9a-f]{6}$/i, "Use a hex colour like #B3121B."),
});

const variantInput = z.object({
  /** Omit for a new variant — the server builds one from the product SKU, size and colour. */
  sku: sku.optional(),
  size: text(40).min(1).nullable(),
  color: colorInput.nullable(),
  /** Opening stock for a NEW variant. Existing variants change stock only via inventory adjustments. */
  initialStock: z.number().int().min(0).max(100_000).optional(),
  lowStockThreshold: z.number().int().min(0).max(10_000).default(2),
});

export const productBody = z
  .object({
    name: text(160).min(1, "Enter a product name."),
    slug,
    sku,
    audience: z.enum(AUDIENCES),
    /** Category slug. */
    category: slug,
    tags: z.array(slug).max(20).default([]),
    shortDescription: text(300).default(""),
    description: text(5000).default(""),
    images: z.array(imageInput).max(12).default([]),
    pricePaise: paise.min(100, "Enter the selling price."),
    mrpPaise: paise.min(100, "Enter the MRP."),
    variants: z.array(variantInput).min(1, "Add at least one variant.").max(200),
    fabric: text(300).default(""),
    care: z.array(text(200).min(1)).max(20).default([]),
    status: z.enum(["draft", "active", "archived"]),
    featured: z.boolean().default(false),
    newArrival: z.boolean().default(false),
    bestSeller: z.boolean().default(false),
    weightGrams: z.number().int().min(1).max(100_000).optional(),
  })
  .superRefine((p, ctx) => {
    if (p.pricePaise > p.mrpPaise) ctx.addIssue({ code: "custom", path: ["pricePaise"], message: "Selling price can't be more than the MRP." });
    if (p.status === "active" && !p.images.length) ctx.addIssue({ code: "custom", path: ["images"], message: "Add at least one image before publishing." });
    const keys = p.variants.map((v) => `${v.size ?? ""}|${v.color?.name.toLowerCase() ?? ""}`);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", path: ["variants"], message: "Each size and colour combination can only appear once." });
  });

export type ProductBody = z.output<typeof productBody>;

export const productListQuery = pagination.extend({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  q: text(100).optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  audience: z.enum(AUDIENCES).optional(),
  category: slug.optional(),
});

export const bulkProductsBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), ids: z.array(z.string().min(1).max(64)).min(1).max(200), status: z.enum(["draft", "active", "archived"]) }),
  z.object({ action: z.literal("delete"), ids: z.array(z.string().min(1).max(64)).min(1).max(200) }),
]);

export const categoryBody = z.object({
  name: text(80).min(1, "Enter a category name."),
  slug,
  audience: z.enum(AUDIENCES),
  description: text(500).default(""),
  image: imageInput.nullable(),
  visible: z.boolean().default(true),
});

/** Slug and main category are fixed once created (they are part of storefront URLs and menus). */
export const categoryPatch = categoryBody.omit({ slug: true, audience: true }).partial();

export const categoryMoveBody = z.object({ direction: z.union([z.literal(-1), z.literal(1)]) });

export const ADJUST_REASONS = ["Restock", "Return", "Correction", "Damaged", "Sale"] as const;

export const inventoryAdjustBody = z.object({
  productId: z.string().min(1).max(64),
  variantSku: sku,
  mode: z.enum(["add", "remove", "set"]),
  quantity: z.number().int().min(0).max(100_000),
  reason: z.enum(ADJUST_REASONS),
  note: text(300).optional(),
});

export const thresholdBody = z.object({
  productId: z.string().min(1).max(64),
  variantSku: sku,
  threshold: z.number().int().min(0).max(10_000),
});

export const inventoryQuery = z.object({
  includeArchived: queryBoolean.optional(),
});

export const movementsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(30),
  productId: z.string().min(1).max(64).optional(),
});
