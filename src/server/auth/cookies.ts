/**
 * Admin auth cookie names and options. Edge-safe (read by middleware).
 *
 * - Access cookie: short-lived JWT, sent to admin pages (middleware) and admin APIs.
 * - Refresh cookie: restricted to /api/v1/admin/auth, so it only ever travels to the refresh /
 *   logout endpoints — never to pages or other APIs.
 * Both are HttpOnly (no JavaScript access), SameSite=Strict, and Secure in production.
 * They are separate from (future) customer cookies.
 */

export const ADMIN_ACCESS_COOKIE = "mm_admin_at";
export const ADMIN_REFRESH_COOKIE = "mm_admin_rt";
export const ADMIN_REFRESH_PATH = "/api/v1/admin/auth";

const secure = () => process.env.NODE_ENV === "production";

export function adminAccessCookie(value: string, maxAgeSeconds: number) {
  return { name: ADMIN_ACCESS_COOKIE, value, httpOnly: true, secure: secure(), sameSite: "strict" as const, path: "/", maxAge: maxAgeSeconds };
}

export function adminRefreshCookie(value: string, maxAgeSeconds: number) {
  return {
    name: ADMIN_REFRESH_COOKIE,
    value,
    httpOnly: true,
    secure: secure(),
    sameSite: "strict" as const,
    path: ADMIN_REFRESH_PATH,
    maxAge: maxAgeSeconds,
  };
}

/* ---------- Customer cookies (separate names and refresh path from admin) ---------- */

export const CUSTOMER_ACCESS_COOKIE = "mm_at";
export const CUSTOMER_REFRESH_COOKIE = "mm_rt";
export const CUSTOMER_REFRESH_PATH = "/api/v1/auth";
/**
 * Non-secret "signed in" hint readable by the storefront's JavaScript, so guests don't make a
 * session check on every page load. It grants nothing — every API still verifies the session.
 */
export const CUSTOMER_HINT_COOKIE = "mm_signed_in";

/** maxAgeSeconds = undefined → browser-session cookie (cleared when the browser closes). */
export function customerAccessCookie(value: string, maxAgeSeconds: number) {
  return { name: CUSTOMER_ACCESS_COOKIE, value, httpOnly: true, secure: secure(), sameSite: "strict" as const, path: "/", maxAge: maxAgeSeconds };
}

export function customerRefreshCookie(value: string, maxAgeSeconds: number | undefined) {
  return {
    name: CUSTOMER_REFRESH_COOKIE,
    value,
    httpOnly: true,
    secure: secure(),
    sameSite: "strict" as const,
    path: CUSTOMER_REFRESH_PATH,
    ...(maxAgeSeconds !== undefined && { maxAge: maxAgeSeconds }),
  };
}

export function customerHintCookie(value: string, maxAgeSeconds: number | undefined) {
  return {
    name: CUSTOMER_HINT_COOKIE,
    value,
    httpOnly: false,
    secure: secure(),
    sameSite: "lax" as const,
    path: "/",
    ...(maxAgeSeconds !== undefined && { maxAge: maxAgeSeconds }),
  };
}
