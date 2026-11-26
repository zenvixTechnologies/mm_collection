import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { created, ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { createCoupon, listCoupons } from "@/server/services/admin-coupon.service";
import { couponCreateBody, couponListQuery } from "@/server/validation/admin-marketing";
import { parseBody, parseQuery } from "@/server/validation/request";

export const runtime = "nodejs";

/** GET /api/v1/admin/coupons?q=&state=&page=&limit= — coupons with usage and headline figures. */
export const GET = withApi(async (req: NextRequest) => {
  await requireAdmin(req, "coupons:read");
  const { items, meta, summary } = await listCoupons(parseQuery(req, couponListQuery));
  return ok({ items, ...meta, summary }, "Coupons");
});

/** POST /api/v1/admin/coupons — create a coupon (money in paise). */
export const POST = withApi(async (req: NextRequest) => {
  const ctx = await requireAdmin(req, "coupons:write");
  await enforceRateLimit(req, "admin-coupon-write", 60, 60, ctx.admin.id);
  return created(await createCoupon(await parseBody(req, couponCreateBody, { maxBytes: 32 * 1024 }), ctx.actor), "Coupon created");
});
