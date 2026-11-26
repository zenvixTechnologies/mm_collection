import type { NextRequest } from "next/server";
import { withApi } from "@/server/http/handler";
import { shopperForRead, shopperForWrite, shopperOk } from "@/server/http/shopper-routes";
import { clearCart, getCart } from "@/server/services/cart.service";

export const runtime = "nodejs";

/** GET /api/v1/cart — the signed-in customer's or guest's bag, priced live from MongoDB. */
export const GET = withApi(async (req: NextRequest) => {
  const shopper = await shopperForRead(req, "cart");
  return shopperOk(shopper, await getCart(shopper), "Bag");
});

/** DELETE /api/v1/cart — empty the bag. */
export const DELETE = withApi(async (req: NextRequest) => {
  const shopper = await shopperForWrite(req, "cart", { createGuest: false });
  return shopperOk(shopper, await clearCart(shopper), "Bag cleared");
});
