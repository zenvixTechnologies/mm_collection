import type { NextRequest } from "next/server";
import { withApi } from "@/server/http/handler";
import { shopperForWrite, shopperOk } from "@/server/http/shopper-routes";
import { addCartItem } from "@/server/services/cart.service";
import { addCartItemBody } from "@/server/validation/cart";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

/**
 * POST /api/v1/cart/items — add a product variant (chosen by size/colour) to the bag.
 * Body: { productId, size, color, quantity }. Prices are never accepted from the browser.
 * Adds as many as stock allows; `added` says how many actually went in.
 */
export const POST = withApi(async (req: NextRequest) => {
  const shopper = await shopperForWrite(req, "cart", { createGuest: true });
  const body = await parseBody(req, addCartItemBody, { maxBytes: 2048 });
  if (shopper.kind === "anonymous") throw new Error("unreachable: writes create a guest identity");
  const { cart, added } = await addCartItem(shopper, body);
  return shopperOk(shopper, { ...cart, added }, added < body.quantity ? `Only ${added} could be added` : "Added to bag", {
    write: true,
  });
});
