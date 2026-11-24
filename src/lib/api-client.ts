"use client";

import type { ApiErrorCode, ApiFieldIssue, ApiResponse, PaginationMeta } from "@/types/api";

/**
 * Browser client factory for our JSON APIs. Auth lives in HttpOnly cookies the browser sends
 * itself — this code never sees a token. When the short-lived access token expires, the client
 * refreshes once (shared by concurrent calls) and retries the request.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: ApiErrorCode | "NETWORK_ERROR",
    readonly issues?: ApiFieldIssue[],
  ) {
    super(message);
  }
}

export interface ApiResult<T> {
  data: T;
  message: string;
  pagination?: PaginationMeta;
}

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export function createApiClient({ base, refreshPath }: { base: string; refreshPath: string }) {
  const signedOutListeners = new Set<() => void>();
  let refreshing: Promise<boolean> | null = null;

  function refresh(): Promise<boolean> {
    refreshing ??= (async () => {
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const res = await fetch(refreshPath, { method: "POST", credentials: "same-origin" });
          if (res.ok) return true;
          const body = (await res.json().catch(() => null)) as ApiResponse<unknown> | null;
          // Another tab refreshed at the same moment — its new cookie is ours too; try once more.
          if (body && !body.success && body.error.code === "TOKEN_EXPIRED") continue;
          return false;
        }
        return false;
      } catch {
        return false;
      } finally {
        setTimeout(() => (refreshing = null), 0);
      }
    })();
    return refreshing;
  }

  async function request<T>(path: string, init: { method?: Method; body?: unknown; signal?: AbortSignal } = {}): Promise<ApiResult<T>> {
    const send = () =>
      fetch(`${base}${path}`, {
        method: init.method ?? "GET",
        credentials: "same-origin",
        headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: init.signal,
        cache: "no-store",
      });

    let res: Response;
    try {
      res = await send();
      if (res.status === 401) {
        const body = (await res.clone().json().catch(() => null)) as ApiResponse<unknown> | null;
        if (body && !body.success && body.error.code === "TOKEN_EXPIRED" && (await refresh())) res = await send();
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      throw new ApiError("Can't reach the server. Check your connection and try again.", 0, "NETWORK_ERROR");
    }

    const body = (await res.json().catch(() => null)) as ApiResponse<T> | null;
    if (!body) throw new ApiError("Unexpected response from the server.", res.status, "INTERNAL_ERROR");
    if (!body.success) {
      if (res.status === 401) signedOutListeners.forEach((fn) => fn());
      throw new ApiError(body.message, res.status, body.error.code, body.error.issues);
    }
    return { data: body.data, message: body.message, pagination: body.meta?.pagination as PaginationMeta | undefined };
  }

  return {
    request,
    refresh,
    /** Called when the session can't be refreshed (expired, revoked or signed out elsewhere). */
    onSignedOut(fn: () => void) {
      signedOutListeners.add(fn);
      return () => signedOutListeners.delete(fn);
    },
  };
}

/** Readable message for toasts/forms, including the first field issue for validation errors. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const first = err.issues?.[0];
    return first ? `${err.message} (${first.path ? `${first.path}: ` : ""}${first.message})` : err.message;
  }
  return "Something went wrong. Please try again.";
}
