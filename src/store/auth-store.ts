"use client";

import { create } from "zustand";
import type { Address, User } from "@/types";
import { ApiError, errorMessage } from "@/lib/api-client";
import { customerApi, hasSessionHint, onCustomerSignedOut, refreshCustomerSession } from "@/lib/customer-api";

/**
 * Customer session. The source of truth is the server (HttpOnly cookies + MongoDB); this store
 * only mirrors the signed-in profile for the UI. No passwords or tokens are ever kept in the
 * browser.
 */

export type AuthResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fields?: Record<string, string>; code?: string };

type Status = "unknown" | "authenticated" | "anonymous";

export type AddressInput = Address & { label?: string; fullName?: string; mobile?: string; isDefault?: boolean };

export interface SessionInfo {
  id: string;
  current: boolean;
  userAgent: string;
  createdAt: string;
  lastUsedAt: string;
}

interface AuthState {
  user: User | null;
  status: Status;
  /** Restore the session from cookies (refreshing silently if needed). */
  load: () => Promise<void>;
  login: (identifier: string, password: string, remember: boolean) => Promise<AuthResult>;
  register: (data: { fullName: string; email: string; mobile: string; password: string }) => Promise<AuthResult>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<AuthResult<{ count: number }>>;
  updateProfile: (data: Partial<Pick<User, "fullName" | "email" | "mobile">> & { currentPassword?: string }) => Promise<AuthResult>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<AuthResult<{ otherSessionsSignedOut: number }>>;
  listSessions: () => Promise<AuthResult<SessionInfo[]>>;
  revokeSession: (id: string) => Promise<AuthResult>;
  addAddress: (address: AddressInput) => Promise<AuthResult>;
  updateAddress: (id: string, address: AddressInput) => Promise<AuthResult>;
  /** By position in `user.addresses` (default first), as the account page lists them. */
  removeAddress: (index: number) => Promise<AuthResult>;
  setDefaultAddress: (id: string) => Promise<AuthResult>;
}

/** API errors → a form-friendly result, with field messages keyed by field name. */
function fail(err: unknown): { ok: false; error: string; fields?: Record<string, string>; code?: string } {
  if (err instanceof ApiError) {
    const fields = err.issues?.length ? Object.fromEntries(err.issues.map((i) => [i.path.split(".")[0], i.message])) : undefined;
    return { ok: false, error: err.message, fields, code: err.code };
  }
  return { ok: false, error: errorMessage(err) };
}

export const useAuthStore = create<AuthState>()((set, get) => {
  const withAddresses = (addresses: User["addresses"]) => {
    const user = get().user;
    if (user) set({ user: { ...user, addresses } });
  };

  return {
    user: null,
    status: "unknown",

    load: async () => {
      // Guests never get a session cookie, so skip the round trip entirely.
      if (!hasSessionHint()) {
        set({ user: null, status: "anonymous" });
        return;
      }
      try {
        const { data } = await customerApi<{ user: User }>("/auth/me");
        set({ user: data.user, status: "authenticated" });
      } catch {
        if (await refreshCustomerSession()) {
          try {
            const { data } = await customerApi<{ user: User }>("/auth/me");
            set({ user: data.user, status: "authenticated" });
            return;
          } catch {
            /* fall through */
          }
        }
        set({ user: null, status: "anonymous" });
      }
    },

    login: async (identifier, password, remember) => {
      try {
        const { data } = await customerApi<{ user: User }>("/auth/login", { method: "POST", body: { identifier, password, remember } });
        set({ user: data.user, status: "authenticated" });
        return { ok: true, data: undefined };
      } catch (err) {
        return fail(err);
      }
    },

    register: async (body) => {
      try {
        const { data } = await customerApi<{ user: User }>("/auth/register", { method: "POST", body });
        set({ user: data.user, status: "authenticated" });
        return { ok: true, data: undefined };
      } catch (err) {
        return fail(err);
      }
    },

    logout: async () => {
      try {
        await customerApi("/auth/logout", { method: "POST" });
      } catch {
        /* sign out locally regardless */
      }
      set({ user: null, status: "anonymous" });
    },

    logoutAll: async () => {
      try {
        const { data } = await customerApi<{ count: number }>("/auth/logout-all", { method: "POST" });
        set({ user: null, status: "anonymous" });
        return { ok: true, data };
      } catch (err) {
        return fail(err);
      }
    },

    updateProfile: async (patch) => {
      try {
        const { data } = await customerApi<{ user: User }>("/auth/me", { method: "PATCH", body: patch });
        set({ user: data.user });
        return { ok: true, data: undefined };
      } catch (err) {
        return fail(err);
      }
    },

    changePassword: async (currentPassword, newPassword) => {
      try {
        const { data } = await customerApi<{ otherSessionsSignedOut: number }>("/auth/change-password", {
          method: "POST",
          body: { currentPassword, newPassword },
        });
        return { ok: true, data };
      } catch (err) {
        return fail(err);
      }
    },

    listSessions: async () => {
      try {
        return { ok: true, data: (await customerApi<SessionInfo[]>("/auth/sessions")).data };
      } catch (err) {
        return fail(err);
      }
    },

    revokeSession: async (id) => {
      try {
        await customerApi(`/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
        return { ok: true, data: undefined };
      } catch (err) {
        return fail(err);
      }
    },

    addAddress: async (address) => {
      try {
        withAddresses((await customerApi<User["addresses"]>("/account/addresses", { method: "POST", body: address })).data);
        return { ok: true, data: undefined };
      } catch (err) {
        return fail(err);
      }
    },

    updateAddress: async (id, address) => {
      try {
        withAddresses((await customerApi<User["addresses"]>(`/account/addresses/${encodeURIComponent(id)}`, { method: "PUT", body: address })).data);
        return { ok: true, data: undefined };
      } catch (err) {
        return fail(err);
      }
    },

    removeAddress: async (index) => {
      const target = get().user?.addresses[index];
      if (!target) return { ok: false, error: "Address not found." };
      try {
        withAddresses((await customerApi<User["addresses"]>(`/account/addresses/${encodeURIComponent(target.id)}`, { method: "DELETE" })).data);
        return { ok: true, data: undefined };
      } catch (err) {
        return fail(err);
      }
    },

    setDefaultAddress: async (id) => {
      try {
        withAddresses((await customerApi<User["addresses"]>(`/account/addresses/${encodeURIComponent(id)}/default`, { method: "POST" })).data);
        return { ok: true, data: undefined };
      } catch (err) {
        return fail(err);
      }
    },
  };
});

if (typeof window !== "undefined") {
  // A revoked or expired session discovered by any request signs the shopper out here too.
  onCustomerSignedOut(() => useAuthStore.setState({ user: null, status: "anonymous" }));
  // The old demo store kept accounts — including plain-text passwords — in localStorage. Remove it.
  try {
    localStorage.removeItem("mm-auth");
    sessionStorage.removeItem("mm-session-active");
  } catch {
    /* storage unavailable */
  }
}

export function useCurrentUser() {
  return useAuthStore((s) => s.user);
}
