import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { created, ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { createOffer, listOffers } from "@/server/services/admin-coupon.service";
import { offerBody } from "@/server/validation/admin-marketing";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

/** GET /api/v1/admin/offers — announcement-bar offers in display order. */
export const GET = withApi(async (req: NextRequest) => {
  await requireAdmin(req, "coupons:read");
  return ok(await listOffers(), "Offers");
});

/** POST /api/v1/admin/offers */
export const POST = withApi(async (req: NextRequest) => {
  const ctx = await requireAdmin(req, "coupons:write");
  await enforceRateLimit(req, "admin-offer-write", 60, 60, ctx.admin.id);
  return created(await createOffer(await parseBody(req, offerBody, { maxBytes: 8 * 1024 }), ctx.actor), "Offer added");
});
