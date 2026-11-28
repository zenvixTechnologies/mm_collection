import type { NextRequest } from "next/server";
import { requireCustomer } from "@/server/auth/customer-guard";
import { withApi } from "@/server/http/handler";
import { created, ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { createReview, listOrderReviews } from "@/server/services/review.service";
import { orderParams } from "@/server/validation/checkout";
import { orderReviewBody } from "@/server/validation/review";
import { parseBody, parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

type P = { id: string };

/** GET /api/v1/orders/:orderNumber/reviews — per product: may the signed-in owner review it. */
export const GET = withApi<P>(async (req: NextRequest, { params }) => {
  const { userId } = await requireCustomer(req);
  await enforceRateLimit(req, "review-eligibility", 60, 60, userId);
  return ok(await listOrderReviews(userId, parseParams(params, orderParams).id), "Order reviews");
});

/**
 * POST /api/v1/orders/:orderNumber/reviews — { productId, rating, comment, imageIds? }. The only
 * way to submit a review: the signed-in owner of a delivered, paid order containing the product.
 */
export const POST = withApi<P>(async (req: NextRequest, { params }) => {
  const { userId } = await requireCustomer(req);
  await enforceRateLimit(req, "review-write", 10, 60, userId);
  const { id } = parseParams(params, orderParams);
  return created(await createReview(userId, id, await parseBody(req, orderReviewBody, { maxBytes: 16 * 1024 })), "Review published");
});
