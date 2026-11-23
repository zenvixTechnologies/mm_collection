import "server-only";
import type { ApiErrorCode, ApiFieldIssue } from "@/types/api";

interface AppErrorOptions {
  issues?: ApiFieldIssue[];
  /** Extra response headers, e.g. Retry-After on 429. */
  headers?: Record<string, string>;
  /** Underlying error — logged on the server, never sent to the client. */
  cause?: unknown;
}

/**
 * An error whose `message` is safe to show to the client. Throw it from services and
 * route handlers; `withApi` turns it into the standard JSON error envelope.
 * Anything that is not an AppError becomes a generic 500 without internal details.
 */
export class AppError extends Error {
  readonly issues?: ApiFieldIssue[];
  readonly headers?: Record<string, string>;

  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    options: AppErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.issues = options.issues;
    this.headers = options.headers;
  }
}

export const badRequest = (message = "Invalid request.", code: ApiErrorCode = "BAD_REQUEST") =>
  new AppError(400, code, message);

export const validationError = (issues: ApiFieldIssue[], message = "Please check the highlighted fields.") =>
  new AppError(400, "VALIDATION_ERROR", message, { issues });

export const unauthorized = (message = "Please sign in to continue.") => new AppError(401, "UNAUTHORIZED", message);

export const forbidden = (message = "You don't have permission to do that.") => new AppError(403, "FORBIDDEN", message);

export const notFound = (message = "Not found.") => new AppError(404, "NOT_FOUND", message);

export const conflict = (message: string) => new AppError(409, "CONFLICT", message);

export const tooManyRequests = (retryAfterSeconds: number, message = "Too many requests. Please try again shortly.") =>
  new AppError(429, "RATE_LIMITED", message, {
    headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))) },
  });

export const serviceUnavailable = (message = "This service is temporarily unavailable. Please try again shortly.", cause?: unknown) =>
  new AppError(503, "SERVICE_UNAVAILABLE", message, { cause });

/**
 * A required integration is not configured (missing/invalid env vars). The client only ever sees
 * a generic 503; the variable names (never their values) go to the server log.
 */
export class ConfigError extends AppError {
  constructor(
    readonly integration: string,
    readonly problems: string[],
  ) {
    super(503, "SERVICE_UNAVAILABLE", "This service is temporarily unavailable. Please try again shortly.");
    this.name = "ConfigError";
  }

  /** Server-log description — names variables, never values. */
  describe() {
    return `Integration "${this.integration}" is not configured: ${this.problems.join("; ")}`;
  }
}
