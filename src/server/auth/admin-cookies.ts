import "server-only";
import type { NextResponse } from "next/server";
import { ADMIN_ACCESS_COOKIE, ADMIN_REFRESH_COOKIE, ADMIN_REFRESH_PATH, adminAccessCookie, adminRefreshCookie } from "./cookies";

export function setAdminAuthCookies(
  res: NextResponse,
  t: { accessToken: string; accessMaxAge: number; refreshToken: string; refreshMaxAge: number },
) {
  res.cookies.set(adminAccessCookie(t.accessToken, t.accessMaxAge));
  res.cookies.set(adminRefreshCookie(t.refreshToken, t.refreshMaxAge));
  return res;
}

export function clearAdminAuthCookies(res: NextResponse) {
  res.cookies.set(adminAccessCookie("", 0));
  res.cookies.set(adminRefreshCookie("", 0));
  return res;
}

export { ADMIN_ACCESS_COOKIE, ADMIN_REFRESH_COOKIE, ADMIN_REFRESH_PATH };
