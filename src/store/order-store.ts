"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Orders live on the server (/api/v1/orders). Signed-in customers read theirs through their
 * session. Guests have no account, so this browser remembers the order number and the access
 * token returned at checkout for each guest order placed here — never any order details.
 */

export interface GuestOrderRef {
  id: string;
  token: string;
  placedAt: string;
}

const MAX_REMEMBERED = 25;

interface OrderState {
  guestOrders: GuestOrderRef[];
  rememberGuestOrder: (ref: Omit<GuestOrderRef, "placedAt">) => void;
}

export const useOrderStore = create<OrderState>()(
  persist(
    (set, get) => ({
      guestOrders: [],
      rememberGuestOrder: (ref) =>
        set({
          guestOrders: [{ ...ref, placedAt: new Date().toISOString() }, ...get().guestOrders.filter((o) => o.id !== ref.id)].slice(0, MAX_REMEMBERED),
        }),
    }),
    {
      name: "mm-orders",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // v0 kept demo orders that only ever existed in this browser — there is nothing on the
      // server to show for them, so they are dropped.
      migrate: () => ({ guestOrders: [] }) as unknown as OrderState,
    },
  ),
);

/** The access token for a guest order placed in this browser, if any. */
export function guestTokenFor(id: string) {
  const wanted = id.trim().toUpperCase();
  return useOrderStore.getState().guestOrders.find((o) => o.id === wanted)?.token ?? null;
}
