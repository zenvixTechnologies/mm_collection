import type { NextRequest } from "next/server";
import { GUEST_COOKIE, guestKey, readGuestToken } from "@/server/auth/guest";
import { withApi } from "@/server/http/handler";
import { shopperForWrite, shopperOk } from "@/server/http/shopper-routes";
import { getWishlist, mergeIntoWishlist } from "@/server/services/wishlist.service";
import { mergeWishlistBody } from "@/server/validation/cart";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

/**
 * POST /api/v1/wishlist/merge — after sign-in, moves this browser's guest wishlist into the
 * account (and imports product IDs saved in the browser before wishlists lived on the server).
 * Body: { productIds?: string[] }.
 */
export const POST = withApi(async (req: NextRequest) => {
  const { productIds } = await parseBody(req, mergeWishlistBody, { maxBytes: 16 * 1024 });
  const shopper = await shopperForWrite(req, "wishlist-merge", { createGuest: productIds.length > 0 });
  if (shopper.kind === "anonymous") return shopperOk(shopper, await getWishlist(shopper), "Wishlist");
  const token = readGuestToken(req.cookies.get(GUEST_COOKIE)?.value);
  const wishlist = await mergeIntoWishlist(shopper, { guestKey: token ? guestKey(token) : null, productIds });
  return shopperOk(shopper, wishlist, "Wishlist merged", { write: shopper.kind === "guest" });
});
