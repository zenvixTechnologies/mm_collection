import type { NextRequest } from "next/server";
import { GUEST_COOKIE, guestKey, readGuestToken } from "@/server/auth/guest";
import { withApi } from "@/server/http/handler";
import { shopperForWrite, shopperOk } from "@/server/http/shopper-routes";
import { getCart, mergeIntoCart } from "@/server/services/cart.service";
import { mergeCartBody } from "@/server/validation/cart";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

/**
 * POST /api/v1/cart/merge — called by the storefront after sign-in (and once for bags saved in
 * the browser before bags lived on the server). For a customer, this browser's guest bag is
 * merged into the account bag and deleted. Body: { items?: [{ productId, size, color, quantity }] }.
 */
export const POST = withApi(async (req: NextRequest) => {
  const { items } = await parseBody(req, mergeCartBody, { maxBytes: 16 * 1024 });
  const shopper = await shopperForWrite(req, "cart-merge", { createGuest: items.length > 0 });
  if (shopper.kind === "anonymous") return shopperOk(shopper, await getCart(shopper), "Bag");
  const token = readGuestToken(req.cookies.get(GUEST_COOKIE)?.value);
  const cart = await mergeIntoCart(shopper, { guestKey: token ? guestKey(token) : null, items });
  return shopperOk(shopper, cart, "Bag merged", { write: shopper.kind === "guest" });
});
