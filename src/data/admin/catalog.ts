import type { AdminCategory, AdminProduct } from "@/types/admin";
import { categories } from "@/data/categories";
import { products } from "@/data/products";
import { daysAgo } from "./mock-utils";

/**
 * Admin view of the catalogue. Built from the storefront's product and category data,
 * so the admin starts out showing exactly what customers see. Edits made in the admin
 * stay in admin state only (until the API exists) — the storefront data is never mutated.
 */

export const DEFAULT_LOW_STOCK_THRESHOLD = 10;

/** A couple of products are shown as drafts so the status filters have something to show. */
const DRAFT_IDS = new Set(products.slice(-2).map((p) => p.id));

export const mockProducts: AdminProduct[] = products.map((p, i) => ({
  ...p,
  images: [...p.images],
  sizes: [...p.sizes],
  colors: p.colors.map((c) => ({ ...c })),
  care: [...p.care],
  tags: [...p.tags],
  status: DRAFT_IDS.has(p.id) ? "draft" : "active",
  lowStockThreshold: DEFAULT_LOW_STOCK_THRESHOLD,
  updatedAt: daysAgo((i * 7) % 45, 10 + (i % 8), (i * 13) % 60),
}));

export const mockCategories: AdminCategory[] = categories.map((c, i) => ({
  ...c,
  visible: true,
  sortOrder: i,
}));
