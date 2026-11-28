import type { Product, ProductVariant } from "@/types";

/**
 * What can be bought, from each variant's available units (stock − reserved). A product without
 * per-variant data (none from the store's catalogue) falls back to its total.
 */
type Stocked = Pick<Product, "stock" | "sizes" | "variants">;

export interface Choice {
  size?: string | null;
  color?: string | null;
}

/** Units available for a choice. A size or colour not chosen yet matches any. */
export function unitsFor(product: Stocked, { size, color }: Choice = {}): number {
  if (!product.variants) return product.stock;
  return product.variants.reduce((n, v) => ((!size || v.size === size) && (!color || v.color === color) ? n + v.stock : n), 0);
}

/** Can this size be picked? With a colour chosen only that colour counts; otherwise any colour. */
export const sizeInStock = (product: Stocked, size: string, color: string | null) => unitsFor(product, { size, color }) > 0;

/**
 * Colours stay selectable, so a shopper can see each one's sizes. Only where colour is the whole
 * variant (no sizes) is a sold-out colour disabled.
 */
export const colorSelectable = (product: Stocked, color: string) => product.sizes.length > 0 || unitsFor(product, { color }) > 0;

/** The product with fresher variant stock, keeping its total in step. */
export function withVariants<T extends Product>(product: T, variants: ProductVariant[] | null | undefined): T {
  return variants ? { ...product, variants, stock: variants.reduce((n, v) => n + v.stock, 0) } : product;
}
