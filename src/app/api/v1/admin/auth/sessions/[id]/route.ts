import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { listActiveSessions, revokeSession } from "@/server/auth/session.service";
import { notFound } from "@/server/http/errors";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { audit } from "@/server/services/audit.service";
import { sessionIdParams } from "@/server/validation/admin-auth";
import { parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

/** DELETE /api/v1/admin/auth/sessions/:id — sign out one of your own devices. */
export const DELETE = withApi<{ id: string }>(async (req: NextRequest, { params }) => {
  const ctx = await requireAdmin(req);
  const { id } = parseParams(params, sessionIdParams);
  const mine = await listActiveSessions("admin", ctx.admin.id);
  if (!mine.some((s) => s._id.toString() === id)) throw notFound("Session not found.");
  await revokeSession(id, "logout");
  await audit(ctx.actor, "admin.session_revoked", { type: "session", id });
  return ok(null, "Session signed out");
});
