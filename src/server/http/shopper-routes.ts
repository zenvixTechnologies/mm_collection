import "server-only";
import type { NextRequest } from "next/server";
import { resolveShopper, withGuestCookie, type Shopper } from "@/server/auth/shopper";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { ok } from "./response";

/**
 * Shared plumbing for the bag and wishlist endpoints: rate limits (per IP before any database
 * work, then per shopper) → shopper resolution (customer or guest, same-origin for writes).
 */

const SLOW_DOWN = "You're going a little fast — please wait a moment and try again.";

export async function shopperForRead(req: NextRequest, scope: "cart" | "wishlist") {
  await enforceRateLimit(req, `${scope}-read`, 180, 60, undefined, SLOW_DOWN);
  return resolveShopper(req, { createGuest: false });
}

export async function shopperForWrite(
  req: NextRequest,
  scope: "cart" | "wishlist" | "cart-merge" | "wishlist-merge",
  { createGuest = true }: { createGuest?: boolean } = {},
) {
  const merge = scope.endsWith("-merge");
  await enforceRateLimit(req, `${scope}-ip`, merge ? 30 : 150, 60, undefined, SLOW_DOWN);
  const shopper = await resolveShopper(req, { createGuest });
  if (shopper.kind !== "anonymous") await enforceRateLimit(req, scope, merge ? 10 : 60, 60, shopper.rateKey, SLOW_DOWN);
  return shopper;
}

/** JSON success response that also sets/slides the guest cookie for guest writes. */
export function shopperOk<T>(shopper: Shopper, data: T, message: string, { write = false, status = 200 } = {}) {
  return withGuestCookie(ok(data, message, { status }), shopper, { refresh: write });
}
