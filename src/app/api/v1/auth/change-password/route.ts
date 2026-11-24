import type { NextRequest } from "next/server";
import { requireCustomer } from "@/server/auth/customer-guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { changeCustomerPassword } from "@/server/services/customer-auth.service";
import { customerChangePasswordBody } from "@/server/validation/customer-auth";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

/** POST /api/v1/auth/change-password — also signs out every other device. */
export const POST = withApi(async (req: NextRequest) => {
  const { userId, sessionId } = await requireCustomer(req);
  await enforceRateLimit(req, "change-password", 5, 300, userId);
  const { currentPassword, newPassword } = await parseBody(req, customerChangePasswordBody, { maxBytes: 2048 });
  const others = await changeCustomerPassword(userId, sessionId, currentPassword, newPassword);
  return ok({ otherSessionsSignedOut: others }, "Password changed");
});
