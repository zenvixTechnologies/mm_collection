import type { NextRequest } from "next/server";
import { resolveShopper } from "@/server/auth/shopper";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { getOrderForViewer } from "@/server/services/order.service";
import { orderAccessToken, orderParams } from "@/server/validation/checkout";
import { parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

/**
 * GET /api/v1/orders/:id — one order by its order number. Visible only to the signed-in customer
 * who placed it, or to a guest sending that order's access token in the `X-Order-Token` header
 * (returned once at checkout). Everyone else gets 404, exactly as for an order that doesn't exist.
 */
export const GET = withApi<{ id: string }>(async (req: NextRequest, { params }) => {
  await enforceRateLimit(req, "order-read-ip", 60, 60);
  const { id } = parseParams(params, orderParams);
  const shopper = await resolveShopper(req, { createGuest: false });
  const header = orderAccessToken.safeParse(req.headers.get("x-order-token"));
  const order = await getOrderForViewer(id, {
    userId: shopper.kind === "customer" ? shopper.userId : null,
    token: header.success ? header.data : null,
  });
  return ok(order, "Order");
});
