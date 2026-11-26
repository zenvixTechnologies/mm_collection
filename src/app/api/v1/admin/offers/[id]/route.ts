import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { deleteOffer, updateOffer } from "@/server/services/admin-coupon.service";
import { offerParams, offerUpdateBody } from "@/server/validation/admin-marketing";
import { parseBody, parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

type P = { id: string };

/** PATCH /api/v1/admin/offers/:id */
export const PATCH = withApi<P>(async (req: NextRequest, { params }) => {
  const ctx = await requireAdmin(req, "coupons:write");
  await enforceRateLimit(req, "admin-offer-write", 60, 60, ctx.admin.id);
  const { id } = parseParams(params, offerParams);
  return ok(await updateOffer(id, await parseBody(req, offerUpdateBody, { maxBytes: 8 * 1024 }), ctx.actor), "Offer updated");
});

/** DELETE /api/v1/admin/offers/:id */
export const DELETE = withApi<P>(async (req: NextRequest, { params }) => {
  const ctx = await requireAdmin(req, "coupons:write");
  await enforceRateLimit(req, "admin-offer-write", 60, 60, ctx.admin.id);
  return ok(await deleteOffer(parseParams(params, offerParams).id, ctx.actor), "Offer deleted");
});
