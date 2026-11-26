import type { NextRequest } from "next/server";
import { withApi } from "@/server/http/handler";
import { shopperForRead, shopperForWrite, shopperOk } from "@/server/http/shopper-routes";
import { clearWishlist, getWishlist } from "@/server/services/wishlist.service";

export const runtime = "nodejs";

/** GET /api/v1/wishlist — saved products (public IDs, newest first) for the customer or guest. */
export const GET = withApi(async (req: NextRequest) => {
  const shopper = await shopperForRead(req, "wishlist");
  return shopperOk(shopper, await getWishlist(shopper), "Wishlist");
});

/** DELETE /api/v1/wishlist — remove every saved product. */
export const DELETE = withApi(async (req: NextRequest) => {
  const shopper = await shopperForWrite(req, "wishlist", { createGuest: false });
  return shopperOk(shopper, await clearWishlist(shopper), "Wishlist cleared");
});
