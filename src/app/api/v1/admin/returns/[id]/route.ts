import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { adminUpdateReturn } from "@/server/services/after-sales.service";
import { returnParams, returnStatusBody } from "@/server/validation/after-sales";
import { parseBody, parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

/* Returns and cancellations need payments:refund — held by Owner and Manager (who decide refunds), not Staff. */

/** PATCH /api/v1/admin/returns/:id — { status, note? }. Never refunds or restocks anything. */
export const PATCH = withApi<{ id: string }>(async (req: NextRequest, { params }) => {
  const ctx = await requireAdmin(req, "payments:refund");
  await enforceRateLimit(req, "admin-return-write", 60, 60, ctx.admin.id);
  const { id } = parseParams(params, returnParams);
  return ok(await adminUpdateReturn(id, await parseBody(req, returnStatusBody, { maxBytes: 8 * 1024 }), ctx.actor), "Return request updated");
});
