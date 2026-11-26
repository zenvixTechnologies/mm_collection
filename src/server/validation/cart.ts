import "server-only";
import { z } from "zod";
import { MAX_CART_LINES, MAX_LINE_QUANTITY, MAX_WISHLIST_ITEMS } from "@/types";

/**
 * Cart and wishlist request bodies. The browser may only say *which* product/variant and *how
 * many* — any price, discount or total it sends is dropped by these schemas and never read.
 */

/** Public product ID: original catalogue ID (p001) or MongoDB ID. */
export const productRef = z
  .string()
  .trim()
  .min(1, "Choose a product.")
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid product.");

/** A cart line ID is the variant SKU. */
export const variantSku = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Invalid item.")
  .transform((s) => s.toUpperCase());

/** Size / colour as shown on the product page; null when the product has no such option. */
const option = z.string().trim().min(1).max(40).nullable().default(null);

export const quantity = z
  .number({ error: "Quantity must be a number." })
  .int("Quantity must be a whole number.")
  .min(1, "Quantity must be at least 1.")
  .max(MAX_LINE_QUANTITY, `You can add up to ${MAX_LINE_QUANTITY} of one item.`);

export const cartLineInput = z.object({
  productId: productRef,
  size: option,
  color: option,
  quantity,
});

export type CartLineInput = z.output<typeof cartLineInput>;

export const addCartItemBody = cartLineInput.extend({ quantity: quantity.default(1) });

export const updateCartItemBody = z.object({ quantity });

export const cartItemParams = z.object({ id: variantSku });

/** Guest → customer merge, and the one-time import of a bag saved in the browser before accounts. */
export const mergeCartBody = z.object({
  items: z.array(cartLineInput).max(MAX_CART_LINES, `A bag can hold at most ${MAX_CART_LINES} items.`).default([]),
});

export const wishlistItemBody = z.object({ productId: productRef });

export const wishlistItemParams = z.object({ productId: productRef });

export const mergeWishlistBody = z.object({
  productIds: z.array(productRef).max(MAX_WISHLIST_ITEMS).default([]),
});
