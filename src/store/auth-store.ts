"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Address, User } from "@/types";
import { DEMO_USER } from "@/data/orders";

/**
 * MOCK AUTHENTICATION — for the frontend demo only.
 * Accounts live in this browser's localStorage; nothing is sent to a server and
 * passwords are not secured. Replace with a real auth provider before launch.
 */

type Result = { ok: true } | { ok: false; error: string };

interface AuthState {
  users: User[];
  currentUserId: string | null;
  remember: boolean;
  login: (identifier: string, password: string, remember: boolean) => Result;
  register: (data: Pick<User, "fullName" | "email" | "mobile" | "password">) => Result;
  logout: () => void;
  updateProfile: (data: Partial<Pick<User, "fullName" | "email" | "mobile">>) => void;
  addAddress: (address: Address) => void;
  removeAddress: (index: number) => void;
}

export const SESSION_FLAG = "mm-session-active";

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      users: [DEMO_USER],
      currentUserId: null,
      remember: true,

      login: (identifier, password, remember) => {
        const id = identifier.trim().toLowerCase();
        const user = get().users.find(
          (u) => u.email.toLowerCase() === id || u.mobile === id.replace(/\D/g, "").slice(-10),
        );
        if (!user || user.password !== password) {
          return { ok: false, error: "Incorrect email/mobile or password." };
        }
        try {
          sessionStorage.setItem(SESSION_FLAG, "1");
        } catch {
          /* storage unavailable */
        }
        set({ currentUserId: user.id, remember });
        return { ok: true };
      },

      register: ({ fullName, email, mobile, password }) => {
        const users = get().users;
        if (users.some((u) => u.email.toLowerCase() === email.trim().toLowerCase())) {
          return { ok: false, error: "An account with this email already exists." };
        }
        if (users.some((u) => u.mobile === mobile)) {
          return { ok: false, error: "An account with this mobile number already exists." };
        }
        const user: User = {
          id: `u-${Date.now().toString(36)}`,
          fullName: fullName.trim(),
          email: email.trim(),
          mobile,
          password,
          addresses: [],
        };
        try {
          sessionStorage.setItem(SESSION_FLAG, "1");
        } catch {
          /* storage unavailable */
        }
        set({ users: [...users, user], currentUserId: user.id, remember: true });
        return { ok: true };
      },

      logout: () => set({ currentUserId: null }),

      updateProfile: (data) =>
        set({
          users: get().users.map((u) => (u.id === get().currentUserId ? { ...u, ...data } : u)),
        }),

      addAddress: (address) =>
        set({
          users: get().users.map((u) => {
            if (u.id !== get().currentUserId) return u;
            const exists = u.addresses.some(
              (a) => a.house === address.house && a.pincode === address.pincode,
            );
            return exists ? u : { ...u, addresses: [...u.addresses, address] };
          }),
        }),

      removeAddress: (index) =>
        set({
          users: get().users.map((u) =>
            u.id === get().currentUserId
              ? { ...u, addresses: u.addresses.filter((_, i) => i !== index) }
              : u,
          ),
        }),
    }),
    { name: "mm-auth", storage: createJSONStorage(() => localStorage) },
  ),
);

export function useCurrentUser() {
  return useAuthStore((s) => s.users.find((u) => u.id === s.currentUserId) ?? null);
}
