import type { NextRequest } from "next/server";
import { withApi } from "@/server/http/handler";
import { shopperForWrite, shopperOk } from "@/server/http/shopper-routes";
import { removeCartItem, updateCartItem } from "@/server/services/cart.service";
import { cartItemParams, updateCartItemBody } from "@/server/validation/cart";
import { parseBody, parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

type P = { id: string };

/** PATCH /api/v1/cart/items/:id — set a line's quantity (id = variant SKU). Body: { quantity }. */
export const PATCH = withApi<P>(async (req: NextRequest, { params }) => {
  const { id } = parseParams(params, cartItemParams);
  const shopper = await shopperForWrite(req, "cart", { createGuest: false });
  const { quantity } = await parseBody(req, updateCartItemBody, { maxBytes: 512 });
  return shopperOk(shopper, await updateCartItem(shopper, id, quantity), "Bag updated", { write: true });
});

/** DELETE /api/v1/cart/items/:id — remove one line from the bag. */
export const DELETE = withApi<P>(async (req: NextRequest, { params }) => {
  const { id } = parseParams(params, cartItemParams);
  const shopper = await shopperForWrite(req, "cart", { createGuest: false });
  return shopperOk(shopper, await removeCartItem(shopper, id), "Removed from bag", { write: true });
});
