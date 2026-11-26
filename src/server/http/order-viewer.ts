import "server-only";
import type { NextRequest } from "next/server";
import { resolveShopper } from "@/server/auth/shopper";
import type { OrderViewer } from "@/server/services/order.service";
import { orderAccessToken } from "@/server/validation/checkout";

/**
 * Who is asking about an order: the signed-in customer (existing customer session) and/or a guest
 * holding the order's access token (X-Order-Token header). State-changing requests must be
 * same-origin (checked by resolveShopper).
 */
export async function orderViewer(req: NextRequest): Promise<OrderViewer> {
  const shopper = await resolveShopper(req, { createGuest: false });
  const header = orderAccessToken.safeParse(req.headers.get("x-order-token"));
  return { userId: shopper.kind === "customer" ? shopper.userId : null, token: header.success ? header.data : null };
}
