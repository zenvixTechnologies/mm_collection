import type { NextRequest } from "next/server";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { listProductReviews } from "@/server/services/review.service";
import { reviewListQuery, reviewProductParams } from "@/server/validation/review";
import { parseParams, parseQuery } from "@/server/validation/request";

export const runtime = "nodejs";

type P = { ref: string };

/** GET /api/v1/products/:ref/reviews?page= — verified reviews, newest first, with the star summary. */
export const GET = withApi<P>(async (req: NextRequest, { params }) => {
  await enforceRateLimit(req, "review-read-ip", 120, 60);
  const { ref } = parseParams(params, reviewProductParams);
  return ok(await listProductReviews(ref, parseQuery(req, reviewListQuery).page, 10), "Reviews");
});
