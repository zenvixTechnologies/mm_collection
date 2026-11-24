import { NextResponse, type NextRequest } from "next/server";
import { CUSTOMER_REFRESH_COOKIE } from "@/server/auth/cookies";
import { clearCustomerAuthCookies, setCustomerAuthCookies } from "@/server/auth/customer-cookies";
import { AppError, forbidden } from "@/server/http/errors";
import { toErrorResponse, withApi } from "@/server/http/handler";
import { isSameOrigin } from "@/server/http/request-info";
import { refreshCustomerSession } from "@/server/services/customer-auth.service";

export const runtime = "nodejs";

/** POST /api/v1/auth/refresh — rotate the refresh token, issue a new access token. */
export const POST = withApi(async (req: NextRequest, { requestId }) => {
  if (!isSameOrigin(req)) throw forbidden("This request was blocked for your security. Please reload the page and try again.");
  try {
    const issued = await refreshCustomerSession(req.cookies.get(CUSTOMER_REFRESH_COOKIE)?.value);
    const res = NextResponse.json({ success: true, message: "Session refreshed", data: { user: issued.user } });
    return setCustomerAuthCookies(res, issued);
  } catch (err) {
    const res = toErrorResponse(err, requestId, req) as NextResponse;
    // In a two-tab race the browser already holds the new cookies — keep them.
    if (!(err instanceof AppError && err.code === "TOKEN_EXPIRED")) clearCustomerAuthCookies(res);
    return res;
  }
});
