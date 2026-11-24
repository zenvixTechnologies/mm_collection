import type { NextRequest } from "next/server";
import { requireCustomer } from "@/server/auth/customer-guard";
import { listActiveSessions } from "@/server/auth/session.service";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";

export const runtime = "nodejs";

/** GET /api/v1/auth/sessions — this customer's signed-in devices. */
export const GET = withApi(async (req: NextRequest) => {
  const { userId, sessionId } = await requireCustomer(req);
  const sessions = await listActiveSessions("user", userId);
  return ok(
    sessions.map((s) => ({
      id: s._id.toString(),
      current: s._id.toString() === sessionId,
      userAgent: s.userAgent,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
    })),
    "Sessions",
  );
});
