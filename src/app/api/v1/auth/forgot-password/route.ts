import type { NextRequest } from "next/server";
import { forbidden } from "@/server/http/errors";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { isSameOrigin } from "@/server/http/request-info";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { requestPasswordReset } from "@/server/services/customer-auth.service";
import { forgotPasswordBody } from "@/server/validation/customer-auth";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

/**
 * POST /api/v1/auth/forgot-password — always answers the same way, whether or not the email
 * has an account, so it can't be used to discover customers.
 */
export const POST = withApi(async (req: NextRequest) => {
  if (!isSameOrigin(req)) throw forbidden("This request was blocked for your security. Please reload the page and try again.");
  await enforceRateLimit(req, "forgot", 5, 60);
  const { email } = await parseBody(req, forgotPasswordBody, { maxBytes: 1024 });
  await enforceRateLimit(req, "forgot-email", 3, 3600, email);
  await requestPasswordReset(email, req.nextUrl.origin);
  return ok(null, "If an account exists for this email, we've sent a link to reset the password.");
});
