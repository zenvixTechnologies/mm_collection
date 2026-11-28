import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { adminDeleteReview } from "@/server/services/review.service";
import { adminReviewParams } from "@/server/validation/review";
import { parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

/** DELETE /api/v1/admin/reviews/:id — the only change an admin can make. Reviews can't be edited. */
export const DELETE = withApi<{ id: string }>(async (req: NextRequest, { params }) => {
  const ctx = await requireAdmin(req, "reviews:moderate");
  await enforceRateLimit(req, "admin-review-delete", 60, 60, ctx.admin.id);
  return ok(await adminDeleteReview(parseParams(params, adminReviewParams).id, ctx.actor), "Review deleted");
});
