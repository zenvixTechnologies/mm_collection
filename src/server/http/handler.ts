import "server-only";
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import { AppError, ConfigError } from "./errors";
import { fail } from "./response";
import { logger, serializeError } from "@/server/utils/logger";
import { zodIssues } from "@/server/validation/request";

/**
 * Wraps every /api/v1 route handler.
 *
 * Request flow (later phases plug in between): withApi → auth → authorization → rate limit
 * → Zod validation → service → repository → MongoDB. Handlers stay thin and simply throw:
 * AppError → its status and safe message; ZodError → 400 with field issues; known database
 * errors → 409/400/503; anything else → a generic 500 with no internal details.
 */

export interface ApiContext<P> {
  params: P;
  requestId: string;
}

type Params = Record<string, string | string[] | undefined>;

/** Next.js 15 passes dynamic route params as a promise. */
interface RouteContext<P> {
  params: Promise<P>;
}

export function withApi<P extends Params = Params>(
  handler: (req: NextRequest, ctx: ApiContext<P>) => Promise<Response> | Response,
) {
  return async (req: NextRequest, context: RouteContext<P>): Promise<Response> => {
    const requestId = req.headers.get("x-vercel-id")?.split("::").pop() || randomUUID();
    let res: Response;
    try {
      const params = (await context?.params) ?? ({} as P);
      res = await handler(req, { params, requestId });
    } catch (err) {
      res = toErrorResponse(err, requestId, req);
    }
    res.headers.set("X-Request-Id", requestId);
    // API responses are private unless a handler explicitly opts into caching (public catalogue).
    if (!res.headers.has("Cache-Control")) res.headers.set("Cache-Control", "no-store");
    return res;
  };
}

export function toErrorResponse(err: unknown, requestId: string, req?: Pick<Request, "method" | "url">): Response {
  const where = req ? { method: req.method, path: safePath(req.url) } : {};

  if (err instanceof ConfigError) {
    logger.error("config.missing", { requestId, ...where, detail: err.describe() });
    return fail(err.status, err.code, err.message, { requestId });
  }

  if (err instanceof AppError) {
    if (err.status >= 500) {
      logger.error("api.error", { requestId, ...where, code: err.code, error: serializeError(err.cause ?? err) });
    }
    return fail(err.status, err.code, err.message, { issues: err.issues, requestId, headers: err.headers });
  }

  if (err instanceof ZodError) {
    return fail(400, "VALIDATION_ERROR", "Please check the highlighted fields.", { issues: zodIssues(err), requestId });
  }

  const dbError = mapDatabaseError(err);
  if (dbError) {
    if (dbError.status >= 500) logger.error("db.error", { requestId, ...where, error: serializeError(err) });
    return fail(dbError.status, dbError.code, dbError.message, { requestId });
  }

  logger.error("api.unhandled", { requestId, ...where, error: serializeError(err) });
  return fail(500, "INTERNAL_ERROR", "Something went wrong. Please try again.", { requestId });
}

/** Recognise Mongo/Mongoose errors by name so callers never leak driver messages. */
function mapDatabaseError(err: unknown): Pick<AppError, "status" | "code" | "message"> | null {
  if (!(err instanceof Error)) return null;
  const e = err as Error & { code?: unknown };
  if (e.code === 11000 || e.code === 11001) {
    return { status: 409, code: "CONFLICT", message: "A record with these details already exists." };
  }
  switch (e.name) {
    case "CastError":
      return { status: 400, code: "INVALID_ID", message: "Invalid identifier." };
    case "ValidationError":
      return { status: 400, code: "VALIDATION_ERROR", message: "Some of the details are invalid." };
    case "VersionError":
      return { status: 409, code: "CONFLICT", message: "This record was changed by someone else. Please reload and try again." };
    case "MongooseServerSelectionError":
    case "MongoServerSelectionError":
    case "MongoNetworkError":
    case "MongoNetworkTimeoutError":
    case "MongoNotConnectedError":
      return { status: 503, code: "DATABASE_UNAVAILABLE", message: "We're having trouble reaching our servers. Please try again shortly." };
    default:
      return null;
  }
}

function safePath(url: string) {
  try {
    return new URL(url).pathname; // drop the query string: it may carry tokens or personal data
  } catch {
    return undefined;
  }
}
