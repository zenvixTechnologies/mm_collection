"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface UIState {
  cartOpen: boolean;
  searchOpen: boolean;
  menuOpen: boolean;
  quickAddId: string | null;
  setCartOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setMenuOpen: (open: boolean) => void;
  openQuickAdd: (id: string) => void;
  closeQuickAdd: () => void;
}

export const useUIStore = create<UIState>()((set) => ({
  cartOpen: false,
  searchOpen: false,
  menuOpen: false,
  quickAddId: null,
  setCartOpen: (cartOpen) => set({ cartOpen, searchOpen: false, menuOpen: false }),
  setSearchOpen: (searchOpen) => set({ searchOpen, cartOpen: false, menuOpen: false }),
  setMenuOpen: (menuOpen) => set({ menuOpen, cartOpen: false, searchOpen: false }),
  openQuickAdd: (quickAddId) => set({ quickAddId }),
  closeQuickAdd: () => set({ quickAddId: null }),
}));

/* ---------- Toasts ---------- */

export type ToastTone = "success" | "error" | "info";

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  action?: { label: string; href: string };
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, tone?: ToastTone, action?: Toast["action"]) => void;
  dismiss: (id: number) => void;
}

let toastId = 0;

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],
  push: (message, tone = "success", action) => {
    const id = ++toastId;
    set({ toasts: [...get().toasts.slice(-2), { id, message, tone, action }] });
    setTimeout(() => get().dismiss(id), 3200);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = {
  success: (m: string, action?: Toast["action"]) => useToastStore.getState().push(m, "success", action),
  error: (m: string) => useToastStore.getState().push(m, "error"),
  info: (m: string, action?: Toast["action"]) => useToastStore.getState().push(m, "info", action),
};

/* ---------- Recently viewed ---------- */

interface RecentState {
  ids: string[];
  add: (id: string) => void;
}

export const useRecentStore = create<RecentState>()(
  persist(
    (set, get) => ({
      ids: [],
      add: (id) => set({ ids: [id, ...get().ids.filter((x) => x !== id)].slice(0, 12) }),
    }),
    { name: "mm-recent", storage: createJSONStorage(() => localStorage) },
  ),
);
