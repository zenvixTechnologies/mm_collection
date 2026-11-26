import type { NextRequest } from "next/server";
import { resolveShopper } from "@/server/auth/shopper";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { quoteCheckout } from "@/server/services/checkout.service";
import { checkoutValidateBody } from "@/server/validation/checkout";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

const SLOW_DOWN = "You're going a little fast — please wait a moment and try again.";

/**
 * POST /api/v1/checkout/validate — price and check what the shopper is about to buy, without
 * creating anything. Body: { source: { type: "cart" } | { type: "buy-now", item }, couponCode?,
 * expectedPrices? }. Returns a CheckoutQuote: variant prices, server totals, coupon result and any
 * issues (unavailable, out of stock, price changed).
 */
export const POST = withApi(async (req: NextRequest) => {
  await enforceRateLimit(req, "checkout-validate-ip", 120, 60, undefined, SLOW_DOWN);
  const shopper = await resolveShopper(req, { createGuest: false });
  if (shopper.kind !== "anonymous") await enforceRateLimit(req, "checkout-validate", 60, 60, shopper.rateKey, SLOW_DOWN);
  const body = await parseBody(req, checkoutValidateBody, { maxBytes: 8 * 1024 });
  return ok(await quoteCheckout(shopper, body), "Checkout quote");
});
