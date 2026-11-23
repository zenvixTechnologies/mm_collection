import { NextResponse, type NextRequest } from "next/server";
import { setAdminAuthCookies } from "@/server/auth/admin-cookies";
import { forbidden } from "@/server/http/errors";
import { withApi } from "@/server/http/handler";
import { clientIp, isSameOrigin, userAgent } from "@/server/http/request-info";
import { loginAdmin } from "@/server/services/admin-auth.service";
import { adminLoginBody } from "@/server/validation/admin-auth";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

/** POST /api/v1/admin/auth/login — username or email + password → HttpOnly session cookies. */
export const POST = withApi(async (req: NextRequest) => {
  if (!isSameOrigin(req)) throw forbidden("This request was blocked for your security. Please reload the page and try again.");
  const { identifier, password } = await parseBody(req, adminLoginBody, { maxBytes: 2048 });
  const issued = await loginAdmin(identifier, password, { ip: clientIp(req), userAgent: userAgent(req) });
  const res = NextResponse.json({ success: true, message: "Signed in", data: { admin: issued.profile } });
  return setAdminAuthCookies(res, issued);
});
