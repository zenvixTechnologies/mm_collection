import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { getPayment } from "@/server/services/admin-payment.service";
import { paymentParams } from "@/server/validation/admin-sales";
import { parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

/** GET /api/v1/admin/payments/:id — one attempt with failures, refunds and webhook history. */
export const GET = withApi<{ id: string }>(async (req: NextRequest, { params }) => {
  await requireAdmin(req, "payments:read");
  return ok(await getPayment(parseParams(params, paymentParams).id), "Payment");
});
