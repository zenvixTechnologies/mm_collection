"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { adminApi, errorMessage } from "@/lib/admin-api";

export type AdminQueryStatus = "loading" | "ready" | "error";

/**
 * Loads one admin API resource (e.g. "/customers?page=2&q=…") and reloads whenever the path
 * changes. While a new page/filter loads, the previous data stays on screen (`refreshing`).
 * Pass null to skip loading.
 */
export function useAdminQuery<T>(path: string | null) {
  const [state, setState] = useState<{ data: T | null; status: AdminQueryStatus; error: string | null; refreshing: boolean }>({
    data: null,
    status: "loading",
    error: null,
    refreshing: false,
  });
  const [nonce, setNonce] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    if (!path) return;
    const id = ++latest.current;
    const ctrl = new AbortController();
    setState((s) => ({ ...s, status: s.data ? s.status : "loading", refreshing: true, error: null }));
    adminApi<T>(path, { signal: ctrl.signal })
      .then((res) => id === latest.current && setState({ data: res.data, status: "ready", error: null, refreshing: false }))
      .catch((err: unknown) => {
        if ((err as Error).name === "AbortError" || id !== latest.current) return;
        setState((s) => ({ ...s, status: s.data ? "ready" : "error", error: errorMessage(err), refreshing: false }));
      });
    return () => ctrl.abort();
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  /** Replace the loaded data with a server response (e.g. after a successful update). */
  const replace = useCallback((data: T) => setState({ data, status: "ready", error: null, refreshing: false }), []);
  return { ...state, reload, replace };
}

/** Builds "/path?a=1&b=x" from the defined, non-empty values only. */
export function withQuery(path: string, params: Record<string, string | number | undefined | null>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}
