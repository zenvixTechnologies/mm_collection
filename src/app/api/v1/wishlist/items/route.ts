import type { NextRequest } from "next/server";
import { withApi } from "@/server/http/handler";
import { shopperForWrite, shopperOk } from "@/server/http/shopper-routes";
import { addToWishlist } from "@/server/services/wishlist.service";
import { wishlistItemBody } from "@/server/validation/cart";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

/** POST /api/v1/wishlist/items — save a product. Body: { productId }. Saving twice is a no-op. */
export const POST = withApi(async (req: NextRequest) => {
  const shopper = await shopperForWrite(req, "wishlist", { createGuest: true });
  const { productId } = await parseBody(req, wishlistItemBody, { maxBytes: 512 });
  if (shopper.kind === "anonymous") throw new Error("unreachable: writes create a guest identity");
  return shopperOk(shopper, await addToWishlist(shopper, productId), "Saved to wishlist", { write: true });
});
