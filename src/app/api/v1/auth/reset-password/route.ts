import type { NextRequest } from "next/server";
import { forbidden } from "@/server/http/errors";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { isSameOrigin } from "@/server/http/request-info";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { resetPassword } from "@/server/services/customer-auth.service";
import { resetPasswordBody } from "@/server/validation/customer-auth";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

/** POST /api/v1/auth/reset-password — single-use token + new password; signs out every device. */
export const POST = withApi(async (req: NextRequest) => {
  if (!isSameOrigin(req)) throw forbidden("This request was blocked for your security. Please reload the page and try again.");
  await enforceRateLimit(req, "reset", 10, 60);
  const { token, password } = await parseBody(req, resetPasswordBody, { maxBytes: 2048 });
  await resetPassword(token, password);
  return ok(null, "Your password has been reset. Please log in with your new password.");
});
