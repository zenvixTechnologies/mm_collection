/**
 * Response envelope shared by every /api/v1 endpoint. Safe to import from client code.
 */

export const API_ERROR_CODES = [
  "BAD_REQUEST",
  "VALIDATION_ERROR",
  "INVALID_JSON",
  "INVALID_ID",
  "UNAUTHORIZED",
  /** Access token expired — call the refresh endpoint and retry. */
  "TOKEN_EXPIRED",
  "ACCOUNT_LOCKED",
  "FORBIDDEN",
  "NOT_FOUND",
  "METHOD_NOT_ALLOWED",
  "CONFLICT",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
  "SERVICE_UNAVAILABLE",
  "DATABASE_UNAVAILABLE",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiFieldIssue {
  /** Dotted path to the offending field, e.g. "address.pincode". Empty for whole-object issues. */
  path: string;
  message: string;
}

export interface ApiSuccess<T> {
  success: true;
  message: string;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiFailure {
  success: false;
  message: string;
  error: {
    code: ApiErrorCode;
    /** Field-level problems for VALIDATION_ERROR responses. */
    issues?: ApiFieldIssue[];
    /** Quote this when contacting support; matches the X-Request-Id header and server logs. */
    requestId?: string;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
