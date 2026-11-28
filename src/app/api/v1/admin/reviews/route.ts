import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { adminListReviews } from "@/server/services/review.service";
import { adminReviewListQuery } from "@/server/validation/review";
import { parseQuery } from "@/server/validation/request";

export const runtime = "nodejs";

/** GET /api/v1/admin/reviews?q=&rating=&page=&limit= — submitted reviews, newest first. */
export const GET = withApi(async (req: NextRequest) => {
  await requireAdmin(req, "reviews:moderate");
  const { items, meta } = await adminListReviews(parseQuery(req, adminReviewListQuery));
  return ok({ items, ...meta }, "Reviews");
});
