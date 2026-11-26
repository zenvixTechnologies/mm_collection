"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { MAX_LINE_QUANTITY, type CartItem, type CartSnapshot, type CheckoutCoupon, type CheckoutSource, type Product, type Size } from "@/types";
import { ApiError, errorMessage, type Method } from "@/lib/api-client";
import { customerApi } from "@/lib/customer-api";
import { fetchQuote } from "@/lib/checkout-api";
import { toast } from "@/store/ui-store";

/**
 * The shopping bag. The server (/api/v1/cart) is the source of truth for every line, price and
 * stock figure — guests included, through an HttpOnly guest cookie. This store mirrors the last
 * server response for the UI, applies quantity changes optimistically, and reconciles with the
 * server's answer. Only the chosen coupon code is kept in the browser; whether it applies, and
 * its discount, is always decided by the server (/api/v1/checkout/validate).
 */

export type AddResult = { ok: true; quantity: number } | { ok: false; error: string };
export type CouponResult = { ok: true; coupon: CheckoutCoupon } | { ok: false; error: string };
export type CartStatus = "idle" | "loading" | "ready" | "error";

interface CartState {
  items: CartItem[];
  couponCode: string | null;
  /** idle → not loaded yet; loading → first load in flight; ready; error → couldn't load. */
  status: CartStatus;
  error: string | null;
  /** Load the bag ("load"), or merge this browser's guest bag / saved bag into it ("merge"). */
  sync: (mode?: "load" | "merge") => Promise<void>;
  addItem: (product: Product, size: Size | null, color: string | null, quantity?: number) => Promise<AddResult>;
  updateQuantity: (key: string, quantity: number) => Promise<AddResult>;
  removeItem: (key: string) => Promise<boolean>;
  clear: () => Promise<void>;
  /** Checks the code on the server against the bag (or Buy Now line) and keeps it if it applies. */
  applyCoupon: (code: string, source?: CheckoutSource) => Promise<CouponResult>;
  removeCoupon: () => void;
  /** After an order: the server has already emptied the bag — mirror that. */
  orderPlaced: () => void;
}

/* ---------- One-time import of bags saved in the browser before bags lived on the server ---------- */

const IMPORT_KEY = "mm-cart-import";

interface ImportLine {
  productId: string;
  size: string | null;
  color: string | null;
  quantity: number;
}

function stashLegacyLines(items: unknown) {
  if (!Array.isArray(items) || !items.length) return;
  const lines: ImportLine[] = items
    .filter((i): i is CartItem => !!i && typeof i === "object" && typeof (i as CartItem).productId === "string")
    .slice(0, 50)
    .map((i) => ({
      productId: i.productId,
      size: i.size ?? null,
      color: i.color ?? null,
      quantity: Math.max(1, Math.min(MAX_LINE_QUANTITY, Math.floor(Number(i.quantity)) || 1)),
    }));
  try {
    if (lines.length) localStorage.setItem(IMPORT_KEY, JSON.stringify(lines));
  } catch {
    /* storage unavailable */
  }
}

function readImport(): ImportLine[] {
  try {
    const raw = JSON.parse(localStorage.getItem(IMPORT_KEY) ?? "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/* ---------- API plumbing ---------- */

/**
 * customerApi refreshes an expired customer session itself. If that fails the session cookies
 * are cleared, so one retry continues as a guest instead of showing an error.
 */
async function call<T>(path: string, method: Method = "GET", body?: unknown) {
  try {
    return await customerApi<T>(path, { method, body });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return customerApi<T>(path, { method, body });
    throw err;
  }
}

/** Every request gets a number; only the newest response may overwrite the bag. */
let seq = 0;

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => {
      const apply = (id: number, snap: CartSnapshot, { notify = true } = {}) => {
        if (notify) snap.notices.forEach((n) => toast.info(n));
        if (id === seq) set({ items: snap.items, status: "ready", error: null });
      };

      /** After a failed change, show what the server really has. */
      const resync = () => void get().sync("load");

      return {
        items: [],
        couponCode: null,
        status: "idle",
        error: null,

        sync: async (mode = "load") => {
          const id = ++seq;
          if (get().status !== "ready") set({ status: "loading", error: null });
          try {
            const pending = readImport();
            const { data } =
              mode === "merge" || pending.length
                ? await call<CartSnapshot>("/cart/merge", "POST", { items: pending })
                : await call<CartSnapshot>("/cart");
            if (pending.length) localStorage.removeItem(IMPORT_KEY);
            apply(id, data);
          } catch (err) {
            if (id === seq) set({ status: get().status === "ready" ? "ready" : "error", error: errorMessage(err) });
          }
        },

        addItem: async (product, size, color, quantity = 1) => {
          if (product.stock <= 0) return { ok: false, error: "Sorry, this item is out of stock." };
          const id = ++seq;
          try {
            const { data } = await call<CartSnapshot & { added: number }>("/cart/items", "POST", {
              productId: product.id,
              size,
              color,
              quantity,
            });
            apply(id, data);
            return { ok: true, quantity: data.added };
          } catch (err) {
            if (id === seq) resync();
            return { ok: false, error: errorMessage(err) };
          }
        },

        updateQuantity: async (key, quantity) => {
          if (quantity < 1) return (await get().removeItem(key)) ? { ok: true, quantity: 0 } : { ok: false, error: "Couldn't remove the item." };
          const line = get().items.find((i) => i.key === key);
          if (!line) return { ok: false, error: "Item not found in bag." };
          const id = ++seq;
          set({ items: get().items.map((i) => (i.key === key ? { ...i, quantity } : i)) });
          try {
            const { data } = await call<CartSnapshot>(`/cart/items/${encodeURIComponent(key)}`, "PATCH", { quantity });
            apply(id, data);
            return { ok: true, quantity };
          } catch (err) {
            if (id === seq) resync();
            return { ok: false, error: errorMessage(err) };
          }
        },

        removeItem: async (key) => {
          const id = ++seq;
          set({ items: get().items.filter((i) => i.key !== key) });
          try {
            const { data } = await call<CartSnapshot>(`/cart/items/${encodeURIComponent(key)}`, "DELETE");
            apply(id, data);
            return true;
          } catch (err) {
            // Already gone (another tab removed it) is fine.
            if (err instanceof ApiError && err.status === 404) {
              if (id === seq) resync();
              return true;
            }
            if (id === seq) resync();
            toast.error(errorMessage(err));
            return false;
          }
        },

        clear: async () => {
          const id = ++seq;
          set({ items: [], couponCode: null });
          try {
            apply(id, (await call<CartSnapshot>("/cart", "DELETE")).data, { notify: false });
          } catch {
            if (id === seq) resync();
          }
        },

        applyCoupon: async (code, source = { type: "cart" }) => {
          const wanted = code.trim().toUpperCase();
          if (!wanted) return { ok: false, error: "Please enter a coupon code." };
          if (!/^[A-Z0-9_-]{1,40}$/.test(wanted)) return { ok: false, error: `"${wanted}" is not a valid coupon code.` };
          try {
            const { coupon } = await fetchQuote(source, wanted);
            if (!coupon) return { ok: false, error: "Add something to your bag to use a coupon." };
            if (coupon.status !== "applied") return { ok: false, error: coupon.message ?? `${wanted} can't be used for this order.` };
            set({ couponCode: coupon.code });
            return { ok: true, coupon };
          } catch (err) {
            return { ok: false, error: errorMessage(err) };
          }
        },

        removeCoupon: () => set({ couponCode: null }),

        orderPlaced: () => {
          ++seq; // ignore any response still in flight for the old bag
          set({ items: [], couponCode: null, status: "ready", error: null });
        },
      };
    },
    {
      name: "mm-cart",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Bag lines live on the server; only the chosen coupon stays in the browser.
      partialize: (s) => ({ couponCode: s.couponCode }),
      migrate: (persisted, version) => {
        const old = (persisted ?? {}) as { items?: unknown; couponCode?: string | null };
        // v0 kept the whole bag in localStorage — hand it to the server once, then forget it.
        if (version < 1) stashLegacyLines(old.items);
        return { couponCode: old.couponCode ?? null } as CartState;
      },
    },
  ),
);
