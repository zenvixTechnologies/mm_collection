import type { NextRequest } from "next/server";
import { resolveShopper, withGuestCookie } from "@/server/auth/shopper";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { placeOrder } from "@/server/services/checkout.service";
import { placeOrderBody } from "@/server/validation/checkout";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

const SLOW_DOWN = "Too many order attempts — please wait a minute and try again.";

/**
 * POST /api/v1/checkout/orders — place an order (guest or signed-in customer).
 *
 * Re-validates everything on the server, reserves stock for each exact variant, takes the coupon
 * use and empties the bag in one transaction. The order waits for payment (`Payment Pending`);
 * no payment is taken here. `expectedTotalPaise` must equal the server's total (409
 * PRICE_CHANGED otherwise). Retrying with the same `idempotencyKey` returns the same order (200)
 * instead of creating another (201).
 */
export const POST = withApi(async (req: NextRequest) => {
  await enforceRateLimit(req, "checkout-order-ip", 30, 600, undefined, SLOW_DOWN);
  const shopper = await resolveShopper(req, { createGuest: true });
  if (shopper.kind === "anonymous") throw new Error("unreachable: checkout creates a guest identity");
  await enforceRateLimit(req, "checkout-order", 10, 600, shopper.rateKey, SLOW_DOWN);
  const body = await parseBody(req, placeOrderBody, { maxBytes: 8 * 1024 });
  const { replayed, ...result } = await placeOrder(shopper, body);
  const res = ok(result, replayed ? "Order already placed" : "Order placed", { status: replayed ? 200 : 201 });
  return withGuestCookie(res, shopper, { refresh: false });
});
