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
