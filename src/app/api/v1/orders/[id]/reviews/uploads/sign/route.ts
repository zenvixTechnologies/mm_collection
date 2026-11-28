import type { NextRequest } from "next/server";
import { requireCustomer } from "@/server/auth/customer-guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { signReviewUpload } from "@/server/services/review-image.service";
import { orderParams } from "@/server/validation/checkout";
import { reviewUploadSignBody } from "@/server/validation/review";
import { parseBody, parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

/** POST — { productId, contentType, size }: a one-time signature, only if a review is allowed now. */
export const POST = withApi<{ id: string }>(async (req: NextRequest, { params }) => {
  const { userId } = await requireCustomer(req);
  await enforceRateLimit(req, "review-upload", 40, 600, userId);
  const { id } = parseParams(params, orderParams);
  const body = await parseBody(req, reviewUploadSignBody, { maxBytes: 1024 });
  return ok(await signReviewUpload(userId, id, body.productId), "Upload signed");
});
