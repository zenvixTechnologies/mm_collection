import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { getPayment } from "@/server/services/admin-payment.service";
import { syncRefund } from "@/server/services/refund.service";
import { refundParams } from "@/server/validation/admin-sales";
import { parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

/** POST /api/v1/admin/payments/:id/refunds/:refundId — re-read the refund's status from Razorpay. */
export const POST = withApi<{ id: string; refundId: string }>(async (req: NextRequest, { params }) => {
  const ctx = await requireAdmin(req, "payments:read");
  await enforceRateLimit(req, "admin-refund-sync", 30, 60, ctx.admin.id);
  const { id, refundId } = parseParams(params, refundParams);
  await syncRefund(id, refundId, ctx.actor);
  return ok(await getPayment(id), "Refund status updated");
});
