import "server-only";
import { NextResponse } from "next/server";
import type { ApiErrorCode, ApiFailure, ApiFieldIssue, ApiSuccess, PaginationMeta } from "@/types/api";

interface Init {
  status?: number;
  headers?: HeadersInit;
}

export function ok<T>(data: T, message = "OK", init: Init & { meta?: Record<string, unknown> } = {}) {
  const body: ApiSuccess<T> = { success: true, message, data, ...(init.meta && { meta: init.meta }) };
  return NextResponse.json(body, { status: init.status ?? 200, headers: init.headers });
}

export function created<T>(data: T, message = "Created successfully") {
  return ok(data, message, { status: 201 });
}

export function paginated<T>(items: T[], pagination: PaginationMeta, message = "OK", init: Init = {}) {
  return ok(items, message, { ...init, meta: { pagination } });
}

export function noContent() {
  return new NextResponse(null, { status: 204 });
}

export function fail(
  status: number,
  code: ApiErrorCode,
  message: string,
  extra: { issues?: ApiFieldIssue[]; requestId?: string; headers?: HeadersInit } = {},
) {
  const body: ApiFailure = {
    success: false,
    message,
    error: {
      code,
      ...(extra.issues?.length && { issues: extra.issues }),
      ...(extra.requestId && { requestId: extra.requestId }),
    },
  };
  return NextResponse.json(body, { status, headers: extra.headers });
}

export function paginationMeta(page: number, limit: number, total: number): PaginationMeta {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

/**
 * For public catalogue reads only: CDN may cache for 60s and serve stale for 5 min while
 * refreshing. Never use for anything personal (carts, accounts, orders, payments).
 */
export const PUBLIC_CATALOG_CACHE = { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" };
