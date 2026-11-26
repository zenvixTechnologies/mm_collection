import type { NextRequest } from "next/server";
import { requireCustomer } from "@/server/auth/customer-guard";
import { withApi } from "@/server/http/handler";
import { paginated, paginationMeta } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { listCustomerOrders } from "@/server/services/order.service";
import { orderListQuery } from "@/server/validation/checkout";
import { parseQuery } from "@/server/validation/request";

export const runtime = "nodejs";

/** GET /api/v1/orders?page=1&limit=10 — the signed-in customer's order history, newest first. */
export const GET = withApi(async (req: NextRequest) => {
  await enforceRateLimit(req, "orders-list-ip", 120, 60);
  const { userId } = await requireCustomer(req);
  const { page, limit } = parseQuery(req, orderListQuery);
  const { orders, total } = await listCustomerOrders(userId, { page, limit });
  return paginated(orders, paginationMeta(page, limit, total), "Orders");
});
