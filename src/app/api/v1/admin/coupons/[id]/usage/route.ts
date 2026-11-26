import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { couponUsage } from "@/server/services/admin-coupon.service";
import { couponParams, couponUsageQuery } from "@/server/validation/admin-marketing";
import { parseParams, parseQuery } from "@/server/validation/request";

export const runtime = "nodejs";

/** GET /api/v1/admin/coupons/:id/usage?page=&limit= — orders that used the coupon (newest first). */
export const GET = withApi<{ id: string }>(async (req: NextRequest, { params }) => {
  await requireAdmin(req, "coupons:read");
  const { items, meta } = await couponUsage(parseParams(params, couponParams).id, parseQuery(req, couponUsageQuery));
  return ok({ items, ...meta }, "Coupon usage");
});
