import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { updateOrderStatus } from "@/server/services/admin-order.service";
import { orderNumberParams, orderStatusBody } from "@/server/validation/admin-sales";
import { parseBody, parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

/**
 * PATCH /api/v1/admin/orders/:orderNumber/status — { status, note? }. Fulfilment moves only
 * (Confirmed → … → Delivered, or Cancelled before shipping); payment status can't be set here.
 */
export const PATCH = withApi<{ id: string }>(async (req: NextRequest, { params }) => {
  const ctx = await requireAdmin(req, "orders:write");
  await enforceRateLimit(req, "admin-order-status", 120, 60, ctx.admin.id);
  const { id } = parseParams(params, orderNumberParams);
  const body = await parseBody(req, orderStatusBody, { maxBytes: 4096 });
  return ok(await updateOrderStatus(id, body, ctx.actor), `Order marked as ${body.status}`);
});
