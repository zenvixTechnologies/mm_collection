import { NextResponse, type NextRequest } from "next/server";
import { setAdminAuthCookies } from "@/server/auth/admin-cookies";
import { forbidden } from "@/server/http/errors";
import { withApi } from "@/server/http/handler";
import { isSameOrigin, userAgent } from "@/server/http/request-info";
import { getEnv } from "@/server/config/env";
import { startAdminLoginAttempt } from "@/server/security/admin-login-limit";
import { loginAdmin } from "@/server/services/admin-auth.service";
import { adminLoginBody } from "@/server/validation/admin-auth";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

/**
 * POST /api/v1/admin/auth/login — username or email + password → HttpOnly session cookies.
 * 401 for any wrong credentials, 429 (Retry-After) when rate limited, 503 when attempts can't be
 * counted (see security/admin-login-limit).
 */
export const POST = withApi(async (req: NextRequest) => {
  if (!isSameOrigin(req)) throw forbidden("This request was blocked for your security. Please reload the page and try again.");
  getEnv("auth"); // fail fast (503) if JWT secrets are missing
  const agent = userAgent(req);
  const attempt = await startAdminLoginAttempt(req, { userAgent: agent });
  const { identifier, password } = await parseBody(req, adminLoginBody, { maxBytes: 2048 });
  await attempt.forAccount(identifier);
  const issued = await loginAdmin(identifier, password, { ip: attempt.ip, userAgent: agent });
  await attempt.succeeded([issued.profile.username, issued.profile.email]);
  const res = NextResponse.json({ success: true, message: "Signed in", data: { admin: issued.profile } });
  return setAdminAuthCookies(res, issued);
});
