import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { deleteCoupon, updateCoupon } from "@/server/services/admin-coupon.service";
import { couponParams, couponUpdateBody } from "@/server/validation/admin-marketing";
import { parseBody, parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

type P = { id: string };

/** PATCH /api/v1/admin/coupons/:id — update any fields (e.g. { active: false }). Usage counts can't be set. */
export const PATCH = withApi<P>(async (req: NextRequest, { params }) => {
  const ctx = await requireAdmin(req, "coupons:write");
  await enforceRateLimit(req, "admin-coupon-write", 60, 60, ctx.admin.id);
  const { id } = parseParams(params, couponParams);
  return ok(await updateCoupon(id, await parseBody(req, couponUpdateBody, { maxBytes: 32 * 1024 }), ctx.actor), "Coupon updated");
});

/** DELETE /api/v1/admin/coupons/:id — only for coupons never used on an order (409 otherwise). */
export const DELETE = withApi<P>(async (req: NextRequest, { params }) => {
  const ctx = await requireAdmin(req, "coupons:write");
  await enforceRateLimit(req, "admin-coupon-write", 60, 60, ctx.admin.id);
  return ok(await deleteCoupon(parseParams(params, couponParams).id, ctx.actor), "Coupon deleted");
});
