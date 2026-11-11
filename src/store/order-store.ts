"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Order } from "@/types";
import { sampleOrders } from "@/data/orders";

interface OrderState {
  /** Orders placed in this browser (demo — not sent to a server). */
  orders: Order[];
  addOrder: (order: Order) => void;
}

export const useOrderStore = create<OrderState>()(
  persist(
    (set, get) => ({
      orders: [],
      addOrder: (order) => set({ orders: [order, ...get().orders] }),
    }),
    { name: "mm-orders", storage: createJSONStorage(() => localStorage) },
  ),
);

export function findOrder(placed: Order[], id: string) {
  const normalized = id.trim().toUpperCase();
  return (
    placed.find((o) => o.id === normalized) ?? sampleOrders.find((o) => o.id === normalized) ?? null
  );
}
