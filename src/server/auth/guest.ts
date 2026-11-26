import "server-only";
import { createHash, randomBytes } from "node:crypto";

/**
 * Anonymous shopper identity for guest bags and wishlists.
 *
 * The browser holds a random 256-bit token in an HttpOnly cookie; the database only ever stores
 * its SHA-256 hash, so a leaked database row can't be replayed as a cookie. The cookie is scoped
 * to /api/v1 (pages never receive it) and grants access to nothing but that guest's own bag and
 * wishlist.
 */

export const GUEST_COOKIE = "mm_gid";
export const GUEST_COOKIE_PATH = "/api/v1";
/** Guest bags and wishlists live this long after their last change (sliding; MongoDB TTL index). */
export const GUEST_TTL_SECONDS = 30 * 24 * 60 * 60;

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function newGuestToken() {
  return randomBytes(32).toString("base64url");
}

/** The cookie value, or null when absent or malformed. */
export function readGuestToken(value: string | undefined | null): string | null {
  return value && TOKEN_RE.test(value) ? value : null;
}

/** Database key for a guest token. */
export function guestKey(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function guestExpiry(now = Date.now()) {
  return new Date(now + GUEST_TTL_SECONDS * 1000);
}

export function guestCookie(value: string, maxAgeSeconds = GUEST_TTL_SECONDS) {
  return {
    name: GUEST_COOKIE,
    value,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: GUEST_COOKIE_PATH,
    maxAge: maxAgeSeconds,
  };
}
