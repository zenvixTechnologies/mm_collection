import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { listActiveSessions } from "@/server/auth/session.service";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";

export const runtime = "nodejs";

/** GET /api/v1/admin/auth/sessions — this admin's signed-in devices. */
export const GET = withApi(async (req: NextRequest) => {
  const ctx = await requireAdmin(req);
  const sessions = await listActiveSessions("admin", ctx.admin.id);
  return ok(
    sessions.map((s) => ({
      id: s._id.toString(),
      current: s._id.toString() === ctx.sessionId,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      expiresAt: s.expiresAt,
    })),
    "Sessions",
  );
});
