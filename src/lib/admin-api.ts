"use client";

import { ApiError, createApiClient, errorMessage, type ApiResult } from "./api-client";

/** Browser client for /api/v1/admin (admin session cookies). */
const client = createApiClient({ base: "/api/v1/admin", refreshPath: "/api/v1/admin/auth/refresh" });

export { ApiError as AdminApiError, errorMessage };
export type AdminResult<T> = ApiResult<T>;

export const adminApi = client.request;
export const refreshAdminSession = client.refresh;
export const onAdminSignedOut = client.onSignedOut;
