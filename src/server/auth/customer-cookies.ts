import "server-only";
import type { NextResponse } from "next/server";
import { customerAccessCookie, customerHintCookie, customerRefreshCookie } from "./cookies";

export function setCustomerAuthCookies(
  res: NextResponse,
  t: { accessToken: string; accessMaxAge: number; refreshToken: string; refreshMaxAge: number | undefined },
) {
  res.cookies.set(customerAccessCookie(t.accessToken, t.accessMaxAge));
  res.cookies.set(customerRefreshCookie(t.refreshToken, t.refreshMaxAge));
  res.cookies.set(customerHintCookie("1", t.refreshMaxAge));
  return res;
}

export function clearCustomerAuthCookies(res: NextResponse) {
  res.cookies.set(customerAccessCookie("", 0));
  res.cookies.set(customerRefreshCookie("", 0));
  res.cookies.set(customerHintCookie("", 0));
  return res;
}
