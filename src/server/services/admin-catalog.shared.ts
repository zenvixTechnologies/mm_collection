import "server-only";
import { isValidObjectId, type Types } from "mongoose";
import { revalidateTag } from "next/cache";
import { conflict } from "@/server/http/errors";
import { logger, serializeError } from "@/server/utils/logger";
import { CATALOG_TAG } from "./catalog.service";

/** Product reference → query: original ID (p001), slug or database ID. */
export function productRefFilter(ref: string): Record<string, unknown> {
  const or: Record<string, unknown>[] = [{ legacyId: ref }, { slug: ref.toLowerCase() }];
  if (isValidObjectId(ref)) or.push({ _id: ref });
  return { $or: or };
}

/** Category reference → query: slug or database ID. */
export function categoryRefFilter(ref: string): Record<string, unknown> {
  const or: Record<string, unknown>[] = [{ slug: ref.toLowerCase() }];
  if (isValidObjectId(ref)) or.push({ _id: ref });
  return { $or: or };
}

/** Make admin changes visible on the storefront straight away. */
export function refreshStorefront() {
  try {
    revalidateTag(CATALOG_TAG);
  } catch (err) {
    // Outside a Next.js request (scripts/tests) there is nothing to revalidate.
    logger.debug("catalog.revalidate_skipped", { error: serializeError(err) });
  }
}

/** Turn a duplicate-key error into a message the admin can act on. */
export function duplicateKeyMessage(err: unknown): never | void {
  const e = err as { code?: number; keyPattern?: Record<string, unknown> };
  if (e?.code !== 11000) return;
  const key = Object.keys(e.keyPattern ?? {})[0] ?? "";
  const messages: Record<string, string> = {
    slug: "Another record already uses this URL slug.",
    sku: "Another product already uses this SKU.",
    "variants.sku": "One of the variant SKUs is already used by another product.",
    code: "Another coupon already uses this code.",
    email: "An account with this email already exists.",
  };
  throw conflict(messages[key] ?? "A record with these details already exists.");
}

export type ObjectIdLike = Types.ObjectId | string;
