import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_ACCESS_COOKIE, clearAdminAuthCookies } from "@/server/auth/admin-cookies";
import { decodeExpiredAdminToken } from "@/server/auth/jwt-expired";
import { revokeSession } from "@/server/auth/session.service";
import { forbidden } from "@/server/http/errors";
import { withApi } from "@/server/http/handler";
import { isSameOrigin } from "@/server/http/request-info";

export const runtime = "nodejs";

/**
 * POST /api/v1/admin/auth/logout — ends this session. Works with an expired access token too
 * (its signature is still checked), so signing out always revokes the server-side session.
 */
export const POST = withApi(async (req: NextRequest) => {
  if (!isSameOrigin(req)) throw forbidden("This request was blocked for your security. Please reload the page and try again.");
  const token = req.cookies.get(ADMIN_ACCESS_COOKIE)?.value;
  const sid = token ? await decodeExpiredAdminToken(token) : null;
  if (sid) await revokeSession(sid, "logout");
  return clearAdminAuthCookies(NextResponse.json({ success: true, message: "Signed out", data: null }));
});
