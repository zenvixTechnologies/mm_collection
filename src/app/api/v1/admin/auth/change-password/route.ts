import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { changeAdminPassword } from "@/server/services/admin-auth.service";
import { audit } from "@/server/services/audit.service";
import { changePasswordBody } from "@/server/validation/admin-auth";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

/** POST /api/v1/admin/auth/change-password — also signs out every other device. */
export const POST = withApi(async (req: NextRequest) => {
  const ctx = await requireAdmin(req);
  const { currentPassword, newPassword } = await parseBody(req, changePasswordBody, { maxBytes: 2048 });
  const others = await changeAdminPassword(ctx.admin.id, ctx.sessionId, currentPassword, newPassword);
  await audit(ctx.actor, "admin.password_changed", { type: "admin", id: ctx.admin.id, label: ctx.admin.email ?? ctx.admin.username ?? undefined }, {
    otherSessionsSignedOut: others,
  });
  return ok({ otherSessionsSignedOut: others }, "Password changed");
});
