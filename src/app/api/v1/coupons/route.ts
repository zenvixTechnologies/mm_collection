import type { NextRequest } from "next/server";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { listPublicCoupons } from "@/server/services/coupon.service";

export const runtime = "nodejs";

/**
 * GET /api/v1/coupons — coupons the storefront advertises ("View available coupons"). Whether a
 * coupon actually applies is decided only by POST /api/v1/checkout/validate.
 */
export const GET = withApi(async (req: NextRequest) => {
  await enforceRateLimit(req, "coupons-ip", 120, 60);
  return ok(await listPublicCoupons(), "Coupons");
});
