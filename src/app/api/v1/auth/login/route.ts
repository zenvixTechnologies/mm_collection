import { NextResponse, type NextRequest } from "next/server";
import { setCustomerAuthCookies } from "@/server/auth/customer-cookies";
import { forbidden } from "@/server/http/errors";
import { withApi } from "@/server/http/handler";
import { clientIp, isSameOrigin, userAgent } from "@/server/http/request-info";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { loginCustomer } from "@/server/services/customer-auth.service";
import { customerLoginBody } from "@/server/validation/customer-auth";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

const SLOW_DOWN = "Too many login attempts. Please wait a minute and try again.";

/** POST /api/v1/auth/login — email or mobile + password → HttpOnly session cookies. */
export const POST = withApi(async (req: NextRequest) => {
  if (!isSameOrigin(req)) throw forbidden("This request was blocked for your security. Please reload the page and try again.");
  await enforceRateLimit(req, "login", 5, 60, undefined, SLOW_DOWN);
  const { identifier, password, remember } = await parseBody(req, customerLoginBody, { maxBytes: 2048 });
  await enforceRateLimit(req, "login-id", 10, 900, identifier.toLowerCase(), SLOW_DOWN);
  const issued = await loginCustomer(identifier, password, remember, { ip: clientIp(req), userAgent: userAgent(req) });
  const res = NextResponse.json({ success: true, message: "Logged in", data: { user: issued.user } });
  return setCustomerAuthCookies(res, issued);
});
