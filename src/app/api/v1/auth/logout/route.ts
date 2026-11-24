import { NextResponse, type NextRequest } from "next/server";
import { CUSTOMER_ACCESS_COOKIE } from "@/server/auth/cookies";
import { clearCustomerAuthCookies } from "@/server/auth/customer-cookies";
import { decodeExpiredToken } from "@/server/auth/jwt-expired";
import { revokeSession } from "@/server/auth/session.service";
import { forbidden } from "@/server/http/errors";
import { withApi } from "@/server/http/handler";
import { isSameOrigin } from "@/server/http/request-info";

export const runtime = "nodejs";

/** POST /api/v1/auth/logout — end this session (works even after the access token expired). */
export const POST = withApi(async (req: NextRequest) => {
  if (!isSameOrigin(req)) throw forbidden("This request was blocked for your security. Please reload the page and try again.");
  const token = req.cookies.get(CUSTOMER_ACCESS_COOKIE)?.value;
  const sid = token ? await decodeExpiredToken(token, "customer") : null;
  if (sid) await revokeSession(sid, "logout");
  return clearCustomerAuthCookies(NextResponse.json({ success: true, message: "Logged out", data: null }));
});
