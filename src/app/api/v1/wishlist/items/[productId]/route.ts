import type { NextRequest } from "next/server";
import { withApi } from "@/server/http/handler";
import { shopperForWrite, shopperOk } from "@/server/http/shopper-routes";
import { removeFromWishlist } from "@/server/services/wishlist.service";
import { wishlistItemParams } from "@/server/validation/cart";
import { parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

/** DELETE /api/v1/wishlist/items/:productId — remove a saved product (idempotent). */
export const DELETE = withApi<{ productId: string }>(async (req: NextRequest, { params }) => {
  const { productId } = parseParams(params, wishlistItemParams);
  const shopper = await shopperForWrite(req, "wishlist", { createGuest: false });
  return shopperOk(shopper, await removeFromWishlist(shopper, productId), "Removed from wishlist", { write: true });
});
