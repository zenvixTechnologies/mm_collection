"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { CartItem, Product, Size } from "@/types";
import { cartKey } from "@/lib/utils";
import { validateCoupon, type CouponCheck } from "@/lib/pricing";

export type AddResult = { ok: true; quantity: number } | { ok: false; error: string };

interface CartState {
  items: CartItem[];
  couponCode: string | null;
  addItem: (product: Product, size: Size | null, color: string | null, quantity?: number) => AddResult;
  updateQuantity: (key: string, quantity: number) => AddResult;
  removeItem: (key: string) => void;
  clear: () => void;
  applyCoupon: (code: string, subtotal: number) => CouponCheck;
  removeCoupon: () => void;
}

/** Units of this product already in the cart across every size/colour variant. */
function quantityOfProduct(items: CartItem[], productId: string, exceptKey?: string) {
  return items
    .filter((i) => i.productId === productId && i.key !== exceptKey)
    .reduce((n, i) => n + i.quantity, 0);
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      couponCode: null,

      addItem: (product, size, color, quantity = 1) => {
        if (product.stock <= 0) return { ok: false, error: "Sorry, this item is out of stock." };
        const items = get().items;
        const key = cartKey(product.id, size, color);
        const inCart = quantityOfProduct(items, product.id);
        const available = product.stock - inCart;
        if (available <= 0) {
          return { ok: false, error: `You already have all ${product.stock} available units in your bag.` };
        }
        const qty = Math.min(quantity, available);
        const existing = items.find((i) => i.key === key);
        if (existing) {
          set({ items: items.map((i) => (i.key === key ? { ...i, quantity: i.quantity + qty } : i)) });
        } else {
          set({
            items: [
              ...items,
              {
                key,
                productId: product.id,
                slug: product.slug,
                name: product.name,
                image: product.images[0],
                price: product.price,
                originalPrice: product.originalPrice,
                size,
                color,
                quantity: qty,
                stock: product.stock,
              },
            ],
          });
        }
        return { ok: true, quantity: qty };
      },

      updateQuantity: (key, quantity) => {
        const items = get().items;
        const line = items.find((i) => i.key === key);
        if (!line) return { ok: false, error: "Item not found in bag." };
        if (quantity < 1) {
          set({ items: items.filter((i) => i.key !== key) });
          return { ok: true, quantity: 0 };
        }
        const maxForLine = line.stock - quantityOfProduct(items, line.productId, key);
        if (quantity > maxForLine) {
          set({ items: items.map((i) => (i.key === key ? { ...i, quantity: maxForLine } : i)) });
          return { ok: false, error: `Only ${line.stock} unit${line.stock === 1 ? "" : "s"} in stock.` };
        }
        set({ items: items.map((i) => (i.key === key ? { ...i, quantity } : i)) });
        return { ok: true, quantity };
      },

      removeItem: (key) => set({ items: get().items.filter((i) => i.key !== key) }),

      clear: () => set({ items: [], couponCode: null }),

      applyCoupon: (code, subtotal) => {
        const result = validateCoupon(code, subtotal);
        if (result.ok) set({ couponCode: result.coupon.code });
        return result;
      },

      removeCoupon: () => set({ couponCode: null }),
    }),
    { name: "mm-cart", storage: createJSONStorage(() => localStorage) },
  ),
);
