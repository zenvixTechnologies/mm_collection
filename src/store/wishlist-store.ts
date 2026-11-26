"use client";

import { create } from "zustand";
import type { WishlistSnapshot } from "@/types";
import { ApiError, errorMessage, type Method } from "@/lib/api-client";
import { customerApi } from "@/lib/customer-api";
import { toast } from "@/store/ui-store";

/**
 * Saved products. The server (/api/v1/wishlist) holds the list for customers and guests alike;
 * this store mirrors it. Hearts toggle instantly (optimistic) and roll back if the server says no.
 */

export type WishlistStatus = "idle" | "loading" | "ready" | "error";

interface WishlistState {
  /** Public product IDs, newest first. */
  ids: string[];
  status: WishlistStatus;
  error: string | null;
  /** Load the list ("load"), or merge this browser's guest/saved list into it ("merge"). */
  sync: (mode?: "load" | "merge") => Promise<void>;
  /** Returns true when the product was added, false when removed. */
  toggle: (id: string) => boolean;
  remove: (id: string) => void;
  clear: () => void;
}

/** The pre-server wishlist lived in localStorage under this key ({ state: { ids } }). */
const LEGACY_KEY = "mm-wishlist";

function readLegacyIds(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "null") as { state?: { ids?: unknown } } | null;
    const ids = raw?.state?.ids;
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(x)).slice(0, 200) : [];
  } catch {
    return [];
  }
}

async function call(path: string, method: Method = "GET", body?: unknown) {
  try {
    return (await customerApi<WishlistSnapshot>(path, { method, body })).data;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return (await customerApi<WishlistSnapshot>(path, { method, body })).data;
    throw err;
  }
}

let seq = 0;

export const useWishlistStore = create<WishlistState>()((set, get) => {
  const apply = (id: number, snap: WishlistSnapshot) => {
    if (id === seq) set({ ids: snap.items.map((i) => i.productId), status: "ready", error: null });
  };

  /** Runs a change against the server; on failure restores the previous list and explains why. */
  const send = async (previous: string[], path: string, method: Method, body?: unknown) => {
    const id = ++seq;
    try {
      apply(id, await call(path, method, body));
    } catch (err) {
      if (id === seq) set({ ids: previous });
      toast.error(errorMessage(err));
    }
  };

  return {
    ids: [],
    status: "idle",
    error: null,

    sync: async (mode = "load") => {
      const id = ++seq;
      if (get().status !== "ready") set({ status: "loading", error: null });
      try {
        const legacy = readLegacyIds();
        const snap =
          mode === "merge" || legacy.length ? await call("/wishlist/merge", "POST", { productIds: legacy }) : await call("/wishlist");
        localStorage.removeItem(LEGACY_KEY);
        apply(id, snap);
      } catch (err) {
        if (id === seq) set({ status: get().status === "ready" ? "ready" : "error", error: errorMessage(err) });
      }
    },

    toggle: (productId) => {
      const previous = get().ids;
      const has = previous.includes(productId);
      set({ ids: has ? previous.filter((x) => x !== productId) : [productId, ...previous] });
      void (has
        ? send(previous, `/wishlist/items/${encodeURIComponent(productId)}`, "DELETE")
        : send(previous, "/wishlist/items", "POST", { productId }));
      return !has;
    },

    remove: (productId) => {
      const previous = get().ids;
      set({ ids: previous.filter((x) => x !== productId) });
      void send(previous, `/wishlist/items/${encodeURIComponent(productId)}`, "DELETE");
    },

    clear: () => {
      const previous = get().ids;
      set({ ids: [] });
      void send(previous, "/wishlist", "DELETE");
    },
  };
});
