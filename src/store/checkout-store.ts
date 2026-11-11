"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { CartItem } from "@/types";

/**
 * Holds a single "Buy Now" line so it can go straight to checkout
 * without touching the customer's existing bag.
 */
interface CheckoutState {
  buyNowItem: CartItem | null;
  setBuyNow: (item: CartItem) => void;
  clearBuyNow: () => void;
}

export const useCheckoutStore = create<CheckoutState>()(
  persist(
    (set) => ({
      buyNowItem: null,
      setBuyNow: (item) => set({ buyNowItem: item }),
      clearBuyNow: () => set({ buyNowItem: null }),
    }),
    { name: "mm-buy-now", storage: createJSONStorage(() => sessionStorage) },
  ),
);
