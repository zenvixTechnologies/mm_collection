import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_ACCESS_COOKIE } from "@/server/auth/cookies";
import { verifyAccessToken } from "@/server/auth/jwt";

/**
 * Admin page guard (defence in depth — every admin API also checks the session and permissions
 * itself). Visitors without a valid admin access token are sent to the login page, which first
 * tries a silent token refresh before asking for a password.
 */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (pathname === "/mm-hub/login" || pathname.startsWith("/mm-hub/login/")) return NextResponse.next();

  const verified = await verifyAccessToken(req.cookies.get(ADMIN_ACCESS_COOKIE)?.value, "admin");
  if (verified.ok) return NextResponse.next();

  const login = req.nextUrl.clone();
  login.pathname = "/mm-hub/login";
  login.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(login);
}

export const config = { matcher: ["/mm-hub", "/mm-hub/:path*"] };
