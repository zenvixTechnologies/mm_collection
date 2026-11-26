import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { addOrderNote } from "@/server/services/admin-order.service";
import { orderNoteBody, orderNumberParams } from "@/server/validation/admin-sales";
import { parseBody, parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

/** POST /api/v1/admin/orders/:orderNumber/notes — { text } (staff-only note). */
export const POST = withApi<{ id: string }>(async (req: NextRequest, { params }) => {
  const ctx = await requireAdmin(req, "orders:write");
  await enforceRateLimit(req, "admin-order-note", 120, 60, ctx.admin.id);
  const { id } = parseParams(params, orderNumberParams);
  const { text } = await parseBody(req, orderNoteBody, { maxBytes: 8 * 1024 });
  return ok(await addOrderNote(id, text, ctx.actor), "Note added");
});
