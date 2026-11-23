import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_REFRESH_COOKIE, clearAdminAuthCookies, setAdminAuthCookies } from "@/server/auth/admin-cookies";
import { AppError, forbidden } from "@/server/http/errors";
import { toErrorResponse, withApi } from "@/server/http/handler";
import { clientIp, isSameOrigin, userAgent } from "@/server/http/request-info";
import { refreshAdminSession } from "@/server/services/admin-auth.service";

export const runtime = "nodejs";

/** POST /api/v1/admin/auth/refresh — rotates the refresh token and issues a new access token. */
export const POST = withApi(async (req: NextRequest, { requestId }) => {
  if (!isSameOrigin(req)) throw forbidden("This request was blocked for your security. Please reload the page and try again.");
  try {
    const issued = await refreshAdminSession(req.cookies.get(ADMIN_REFRESH_COOKIE)?.value, {
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
    const res = NextResponse.json({ success: true, message: "Session refreshed", data: { admin: issued.profile } });
    return setAdminAuthCookies(res, issued);
  } catch (err) {
    // A dead session also loses its cookies — except in a two-tab race, where the browser
    // already holds the new ones from the other tab.
    const res = toErrorResponse(err, requestId, req) as NextResponse;
    if (!(err instanceof AppError && err.code === "TOKEN_EXPIRED")) clearAdminAuthCookies(res);
    return res;
  }
});
