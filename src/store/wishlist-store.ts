"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface WishlistState {
  ids: string[];
  /** Returns true when the product was added, false when removed. */
  toggle: (id: string) => boolean;
  remove: (id: string) => void;
  clear: () => void;
}

export const useWishlistStore = create<WishlistState>()(
  persist(
    (set, get) => ({
      ids: [],
      toggle: (id) => {
        const has = get().ids.includes(id);
        set({ ids: has ? get().ids.filter((x) => x !== id) : [id, ...get().ids] });
        return !has;
      },
      remove: (id) => set({ ids: get().ids.filter((x) => x !== id) }),
      clear: () => set({ ids: [] }),
    }),
    { name: "mm-wishlist", storage: createJSONStorage(() => localStorage) },
  ),
);
