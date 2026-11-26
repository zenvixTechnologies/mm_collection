import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { setTracking } from "@/server/services/admin-order.service";
import { orderNumberParams, trackingBody } from "@/server/validation/admin-sales";
import { parseBody, parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

/** PUT /api/v1/admin/orders/:orderNumber/tracking — { courier, awb, url? } for a paid order. */
export const PUT = withApi<{ id: string }>(async (req: NextRequest, { params }) => {
  const ctx = await requireAdmin(req, "orders:write");
  await enforceRateLimit(req, "admin-order-tracking", 120, 60, ctx.admin.id);
  const { id } = parseParams(params, orderNumberParams);
  const body = await parseBody(req, trackingBody, { maxBytes: 4096 });
  return ok(await setTracking(id, body, ctx.actor), "Tracking details saved");
});
