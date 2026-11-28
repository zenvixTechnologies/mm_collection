import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { getOrder } from "@/server/services/admin-order.service";
import { orderNumberParams } from "@/server/validation/admin-sales";
import { parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

/** GET /api/v1/admin/orders/:orderNumber — the full order and its payment summary. */
export const GET = withApi<{ id: string }>(async (req: NextRequest, { params }) => {
  await requireAdmin(req, "orders:read");
  return ok(await getOrder(parseParams(params, orderNumberParams).id), "Order");
});
