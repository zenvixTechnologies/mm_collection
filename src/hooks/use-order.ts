"use client";

import { useEffect, useState } from "react";
import type { StoreOrder } from "@/types";
import { ApiError, errorMessage } from "@/lib/api-client";
import { fetchOrder } from "@/lib/checkout-api";
import { useAuthStore } from "@/store/auth-store";
import { guestTokenFor } from "@/store/order-store";

export type OrderLoadStatus = "loading" | "ready" | "not-found" | "error";

/**
 * One order from the server: the signed-in customer's own, or a guest order placed in this
 * browser (its access token is sent along). Anything else is "not-found".
 */
export function useOrder(id: string | null) {
  const authStatus = useAuthStore((s) => s.status);
  const [state, setState] = useState<{ order: StoreOrder | null; status: OrderLoadStatus; error: string | null }>({
    order: null,
    status: "loading",
    error: null,
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!id || authStatus === "unknown") return;
    const ctrl = new AbortController();
    setState((s) => ({ ...s, status: s.order?.id === id ? "ready" : "loading", error: null }));
    fetchOrder(id, guestTokenFor(id), ctrl.signal)
      .then((order) => setState({ order, status: "ready", error: null }))
      .catch((err: unknown) => {
        if ((err as Error).name === "AbortError") return;
        const missing = err instanceof ApiError && (err.status === 404 || err.status === 400 || err.status === 401);
        setState({ order: null, status: missing ? "not-found" : "error", error: errorMessage(err) });
      });
    return () => ctrl.abort();
  }, [id, authStatus, nonce]);

  return { ...state, status: id ? state.status : ("not-found" as const), retry: () => setNonce((n) => n + 1) };
}
