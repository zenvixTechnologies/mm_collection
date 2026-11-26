"use client";

import { useCallback, useEffect, useState } from "react";
import type { StoreOrder } from "@/types";
import { errorMessage } from "@/lib/api-client";
import { fetchMyOrders, fetchOrder } from "@/lib/checkout-api";
import { useAuthStore } from "@/store/auth-store";
import { useOrderStore } from "@/store/order-store";

const PAGE_SIZE = 10;

interface State {
  orders: StoreOrder[];
  status: "loading" | "ready" | "error";
  error: string | null;
  page: number;
  hasMore: boolean;
  loadingMore: boolean;
}

/**
 * Orders shown in "My Orders", from the server:
 * - signed in: the account's order history, a page at a time
 * - guest: the guest orders placed in this browser (it holds their access tokens)
 */
export function useMyOrders() {
  const authStatus = useAuthStore((s) => s.status);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const guestOrders = useOrderStore((s) => s.guestOrders);
  const guestKey = guestOrders.map((o) => o.id).join(",");
  const [state, setState] = useState<State>({ orders: [], status: "loading", error: null, page: 1, hasMore: false, loadingMore: false });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (authStatus === "unknown") return;
    let cancelled = false;
    setState((s) => ({ ...s, status: "loading", error: null }));
    (async () => {
      try {
        if (userId) {
          const { orders, pagination } = await fetchMyOrders(1, PAGE_SIZE);
          if (!cancelled) setState({ orders, status: "ready", error: null, page: 1, hasMore: !!pagination && pagination.page < pagination.totalPages, loadingMore: false });
          return;
        }
        const refs = useOrderStore.getState().guestOrders;
        const results = await Promise.allSettled(refs.map((r) => fetchOrder(r.id, r.token)));
        const orders = results
          .flatMap((r) => (r.status === "fulfilled" ? [r.value] : []))
          .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
        const allFailed = refs.length > 0 && orders.length === 0 && results.some((r) => r.status === "rejected" && !String(r.reason?.status).startsWith("4"));
        if (!cancelled) {
          setState(
            allFailed
              ? { orders: [], status: "error", error: errorMessage((results[0] as PromiseRejectedResult).reason), page: 1, hasMore: false, loadingMore: false }
              : { orders, status: "ready", error: null, page: 1, hasMore: false, loadingMore: false },
          );
        }
      } catch (err) {
        if (!cancelled) setState((s) => ({ ...s, orders: [], status: "error", error: errorMessage(err) }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authStatus, userId, guestKey, nonce]);

  const loadMore = useCallback(async () => {
    if (!userId || !state.hasMore || state.loadingMore) return;
    setState((s) => ({ ...s, loadingMore: true }));
    try {
      const next = state.page + 1;
      const { orders, pagination } = await fetchMyOrders(next, PAGE_SIZE);
      setState((s) => ({
        ...s,
        orders: [...s.orders, ...orders.filter((o) => !s.orders.some((x) => x.id === o.id))],
        page: next,
        hasMore: !!pagination && pagination.page < pagination.totalPages,
        loadingMore: false,
      }));
    } catch (err) {
      setState((s) => ({ ...s, loadingMore: false, error: errorMessage(err) }));
    }
  }, [userId, state.hasMore, state.loadingMore, state.page]);

  return { ...state, signedIn: !!userId, loadMore, retry: () => setNonce((n) => n + 1) };
}
