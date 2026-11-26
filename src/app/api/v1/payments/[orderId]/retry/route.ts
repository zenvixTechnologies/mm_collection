import type { NextRequest } from "next/server";
import { withApi } from "@/server/http/handler";
import { orderViewer } from "@/server/http/order-viewer";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { startPayment } from "@/server/services/payment.service";
import { paymentOrderParams } from "@/server/validation/payment";
import { parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

/**
 * POST /api/v1/payments/:orderId/retry — a new payment attempt for an unpaid order whose stock is
 * still reserved (same order, same total, no new reservation). Refused while an earlier payment
 * is still processing (409 PAYMENT_IN_PROGRESS), once paid (409 ALREADY_PAID) or after the hold
 * has run out (409 ORDER_EXPIRED — place a new order).
 */
export const POST = withApi<{ orderId: string }>(async (req: NextRequest, { params }) => {
  await enforceRateLimit(req, "payment-retry-ip", 10, 60);
  const viewer = await orderViewer(req);
  const { orderId } = parseParams(params, paymentOrderParams);
  return ok(await startPayment(orderId, viewer, { retry: true }), "Payment ready");
});
