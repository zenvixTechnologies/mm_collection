import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import { AppError, forbidden } from "@/server/http/errors";
import { isSameOrigin } from "@/server/http/request-info";
import { CUSTOMER_ACCESS_COOKIE, CUSTOMER_HINT_COOKIE } from "./cookies";
import { requireCustomer } from "./customer-guard";
import { GUEST_COOKIE, guestCookie, guestKey, newGuestToken, readGuestToken } from "./guest";

/**
 * Who owns the bag/wishlist a request acts on. A signed-in customer always wins over a guest
 * cookie on the same browser; the two are never mixed (except by the explicit merge endpoints).
 */
export type Shopper =
  | { kind: "customer"; userId: string; rateKey: string }
  | { kind: "guest"; key: string; token: string; isNew: boolean; rateKey: string }
  /** A guest with no cookie yet, on a read — nothing to load, nothing created. */
  | { kind: "anonymous"; rateKey: string };

export type OwnerFilter = { user: string } | { guestId: string };

export function ownerFilter(s: Exclude<Shopper, { kind: "anonymous" }>): OwnerFilter {
  return s.kind === "customer" ? { user: s.userId } : { guestId: s.key };
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const BLOCKED = "This request was blocked for your security. Please reload the page and try again.";

/**
 * Resolves the shopper for a cart/wishlist request.
 *
 * - State changes must come from this site (Origin check) — guest requests included.
 * - A customer access token that has expired → 401 TOKEN_EXPIRED so the browser refreshes and
 *   retries. The access cookie disappears with the token, so "no access cookie but the signed-in
 *   hint" is treated the same way — otherwise a customer would silently see a guest bag.
 * - An invalid or revoked token falls back to the guest identity: it never grants anything.
 * - `createGuest` mints a guest token for writes when the browser has none.
 */
export async function resolveShopper(req: NextRequest, { createGuest }: { createGuest: boolean }): Promise<Shopper> {
  if (!SAFE_METHODS.has(req.method) && !isSameOrigin(req)) throw forbidden(BLOCKED);

  const access = req.cookies.get(CUSTOMER_ACCESS_COOKIE)?.value;
  const signedInHint = req.cookies.get(CUSTOMER_HINT_COOKIE)?.value === "1";
  if (access) {
    try {
      const { userId } = await requireCustomer(req);
      return { kind: "customer", userId, rateKey: `u:${userId}` };
    } catch (err) {
      if (!(err instanceof AppError) || err.code === "TOKEN_EXPIRED") throw err;
      // UNAUTHORIZED (revoked/invalid) or FORBIDDEN (suspended): continue as a guest.
    }
  } else if (signedInHint) {
    throw new AppError(401, "TOKEN_EXPIRED", "Your session needs refreshing.");
  }

  const existing = readGuestToken(req.cookies.get(GUEST_COOKIE)?.value);
  if (existing) return { kind: "guest", key: guestKey(existing), token: existing, isNew: false, rateKey: `g:${guestKey(existing).slice(0, 32)}` };
  if (!createGuest) return { kind: "anonymous", rateKey: "anon" };
  const token = newGuestToken();
  return { kind: "guest", key: guestKey(token), token, isNew: true, rateKey: `g:${guestKey(token).slice(0, 32)}` };
}

/** Writes (and slides the expiry of) the guest cookie on responses to guest writes. */
export function withGuestCookie(res: NextResponse, shopper: Shopper, { refresh }: { refresh: boolean }) {
  if (shopper.kind === "guest" && (shopper.isNew || refresh)) res.cookies.set(guestCookie(shopper.token));
  return res;
}
