import "server-only";
import type { z, ZodError, ZodType } from "zod";
import type { ApiFieldIssue } from "@/types/api";
import { AppError, validationError } from "@/server/http/errors";

/** Default JSON body cap. Image bytes go straight to Cloudinary, so API bodies stay small. */
export const DEFAULT_MAX_BODY_BYTES = 100 * 1024;

export function zodIssues(err: ZodError): ApiFieldIssue[] {
  return err.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
}

function parseWith<S extends ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw validationError(zodIssues(result.error));
  return result.data;
}

/** Read, size-check, JSON-parse and validate a request body. */
export async function parseBody<S extends ZodType>(
  req: Request,
  schema: S,
  { maxBytes = DEFAULT_MAX_BODY_BYTES }: { maxBytes?: number } = {},
): Promise<z.output<S>> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) {
    throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Requests must be sent as JSON.");
  }
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();

  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw tooLarge();

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AppError(400, "INVALID_JSON", "The request body is not valid JSON.");
  }
  return parseWith(schema, json);
}

/**
 * Validate the query string. Repeated keys (`?size=M&size=L`) become arrays; use
 * `z.coerce` or the helpers in ./common for numbers and booleans.
 */
export function parseQuery<S extends ZodType>(req: Request | URL, schema: S): z.output<S> {
  const url = req instanceof URL ? req : new URL(req.url);
  const raw: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key);
    raw[key] = all.length > 1 ? all : all[0];
  }
  return parseWith(schema, raw);
}

/** Validate dynamic route params (already awaited by withApi). */
export function parseParams<S extends ZodType>(params: unknown, schema: S): z.output<S> {
  return parseWith(schema, params ?? {});
}

function tooLarge() {
  return new AppError(413, "PAYLOAD_TOO_LARGE", "The request is too large.");
}
