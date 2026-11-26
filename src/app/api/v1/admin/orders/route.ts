import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { listOrders } from "@/server/services/admin-order.service";
import { orderListQuery } from "@/server/validation/admin-sales";
import { parseQuery } from "@/server/validation/request";

export const runtime = "nodejs";

/**
 * GET /api/v1/admin/orders?q=&status=&paymentStatus=&method=&from=&to=&customer=&sort=&dir=&page=&limit=
 * Orders with per-status counts (for the tabs) and net paid revenue of the current filter.
 */
export const GET = withApi(async (req: NextRequest) => {
  await requireAdmin(req, "orders:read");
  const { items, meta, counts, revenue } = await listOrders(parseQuery(req, orderListQuery));
  return ok({ items, ...meta, counts, revenue }, "Orders");
});
