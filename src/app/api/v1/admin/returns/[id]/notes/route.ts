import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { adminAddReturnNote } from "@/server/services/after-sales.service";
import { returnNoteBody, returnParams } from "@/server/validation/after-sales";
import { parseBody, parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

/* Returns and cancellations need payments:refund — held by Owner and Manager (who decide refunds), not Staff. */

/** POST /api/v1/admin/returns/:id/notes — { text }. An internal note; customers never see it. */
export const POST = withApi<{ id: string }>(async (req: NextRequest, { params }) => {
  const ctx = await requireAdmin(req, "payments:refund");
  await enforceRateLimit(req, "admin-return-write", 60, 60, ctx.admin.id);
  const { id } = parseParams(params, returnParams);
  return ok(await adminAddReturnNote(id, (await parseBody(req, returnNoteBody, { maxBytes: 8 * 1024 })).text, ctx.actor), "Note added");
});
