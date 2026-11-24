import { NextResponse, type NextRequest } from "next/server";
import { setCustomerAuthCookies } from "@/server/auth/customer-cookies";
import { forbidden } from "@/server/http/errors";
import { withApi } from "@/server/http/handler";
import { clientIp, isSameOrigin, userAgent } from "@/server/http/request-info";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { registerCustomer } from "@/server/services/customer-auth.service";
import { registerBody } from "@/server/validation/customer-auth";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

/** POST /api/v1/auth/register — create a customer account and sign in. */
export const POST = withApi(async (req: NextRequest) => {
  if (!isSameOrigin(req)) throw forbidden("This request was blocked for your security. Please reload the page and try again.");
  await enforceRateLimit(req, "register", 10, 600, undefined, "Too many sign-up attempts. Please try again in a few minutes.");
  const body = await parseBody(req, registerBody, { maxBytes: 4096 });
  const issued = await registerCustomer(body, { ip: clientIp(req), userAgent: userAgent(req), origin: req.nextUrl.origin });
  const res = NextResponse.json({ success: true, message: "Account created", data: { user: issued.user } }, { status: 201 });
  return setCustomerAuthCookies(res, issued);
});
