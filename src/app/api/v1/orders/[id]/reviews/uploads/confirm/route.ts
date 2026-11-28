import type { NextRequest } from "next/server";
import { requireCustomer } from "@/server/auth/customer-guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { confirmReviewUpload } from "@/server/services/review-image.service";
import { orderParams } from "@/server/validation/checkout";
import { reviewUploadConfirmBody } from "@/server/validation/review";
import { parseBody, parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

/** POST — { productId, uploadId }: checks the file with Cloudinary and returns the ID to submit. */
export const POST = withApi<{ id: string }>(async (req: NextRequest, { params }) => {
  const { userId } = await requireCustomer(req);
  await enforceRateLimit(req, "review-upload", 40, 600, userId);
  const { id } = parseParams(params, orderParams);
  const body = await parseBody(req, reviewUploadConfirmBody, { maxBytes: 1024 });
  return ok(await confirmReviewUpload(userId, id, body.productId, body.uploadId), "Photo uploaded");
});
