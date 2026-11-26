import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { getPayment } from "@/server/services/admin-payment.service";
import { createRefund } from "@/server/services/refund.service";
import { paymentParams, refundBody } from "@/server/validation/admin-sales";
import { parseBody, parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

/**
 * POST /api/v1/admin/payments/:id/refunds — { amountPaise?, reason, idempotencyKey }.
 * Creates a Razorpay refund (full refund of what is left when amountPaise is omitted) and records
 * it from Razorpay's response. Resending the same idempotencyKey returns the first result.
 */
export const POST = withApi<{ id: string }>(async (req: NextRequest, { params }) => {
  const ctx = await requireAdmin(req, "payments:refund");
  await enforceRateLimit(req, "admin-refund", 10, 60, ctx.admin.id, "Too many refund attempts — please wait a minute.");
  const { id } = parseParams(params, paymentParams);
  const body = await parseBody(req, refundBody, { maxBytes: 2048 });
  const { replayed } = await createRefund(id, body, ctx.actor);
  return ok(await getPayment(id), replayed ? "This refund was already created" : "Refund created");
});
