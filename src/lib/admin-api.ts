"use client";

import type { ApiErrorCode, ApiFieldIssue, ApiResponse, PaginationMeta } from "@/types/api";

/**
 * Browser client for /api/v1/admin. Auth lives in HttpOnly cookies the browser sends itself;
 * this module never sees a token. When the 15-minute access token expires, it refreshes once
 * (shared by concurrent calls) and retries the request.
 */

export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: ApiErrorCode | "NETWORK_ERROR",
    readonly issues?: ApiFieldIssue[],
  ) {
    super(message);
  }
}

type Listener = () => void;
const signedOutListeners = new Set<Listener>();
/** Called when the session can't be refreshed (expired, revoked or signed out elsewhere). */
export function onAdminSignedOut(fn: Listener) {
  signedOutListeners.add(fn);
  return () => signedOutListeners.delete(fn);
}

let refreshing: Promise<boolean> | null = null;

/** Rotates the session cookies. Resolves false if the session is gone. */
export function refreshAdminSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch("/api/v1/admin/auth/refresh", { method: "POST", credentials: "same-origin" });
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

export interface AdminResult<T> {
  data: T;
  message: string;
  pagination?: PaginationMeta;
}

export async function adminApi<T>(
  path: string,
  init: { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown; signal?: AbortSignal } = {},
): Promise<AdminResult<T>> {
  const send = () =>
    fetch(`/api/v1/admin${path}`, {
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
      if (body && !body.success && body.error.code === "TOKEN_EXPIRED" && (await refreshAdminSession())) res = await send();
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new AdminApiError("Can't reach the server. Check your connection and try again.", 0, "NETWORK_ERROR");
  }

  const body = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!body) throw new AdminApiError("Unexpected response from the server.", res.status, "INTERNAL_ERROR");
  if (!body.success) {
    if (res.status === 401) signedOutListeners.forEach((fn) => fn());
    throw new AdminApiError(body.message, res.status, body.error.code, body.error.issues);
  }
  return { data: body.data, message: body.message, pagination: body.meta?.pagination as PaginationMeta | undefined };
}

/** Readable message for toasts, including the first field issue for validation errors. */
export function errorMessage(err: unknown): string {
  if (err instanceof AdminApiError) {
    const first = err.issues?.[0];
    return first ? `${err.message} (${first.path ? `${first.path}: ` : ""}${first.message})` : err.message;
  }
  return "Something went wrong. Please try again.";
}
