import { NextResponse, type NextRequest } from "next/server";
import { clearAdminAuthCookies } from "@/server/auth/admin-cookies";
import { requireAdmin } from "@/server/auth/guard";
import { revokeAllSessions } from "@/server/auth/session.service";
import { withApi } from "@/server/http/handler";
import { audit } from "@/server/services/audit.service";

export const runtime = "nodejs";

/** POST /api/v1/admin/auth/logout-all — signs this admin out on every device. */
export const POST = withApi(async (req: NextRequest) => {
  const ctx = await requireAdmin(req);
  const count = await revokeAllSessions("admin", ctx.admin.id, "logout_all");
  await audit(ctx.actor, "admin.logout_all", { type: "admin", id: ctx.admin.id, label: ctx.admin.email ?? ctx.admin.username ?? undefined }, { sessions: count });
  const res = NextResponse.json({ success: true, message: `Signed out of ${count} session${count === 1 ? "" : "s"}`, data: null });
  return clearAdminAuthCookies(res);
});
