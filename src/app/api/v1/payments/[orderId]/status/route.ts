import type { NextRequest } from "next/server";
import { withApi } from "@/server/http/handler";
import { orderViewer } from "@/server/http/order-viewer";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { getPaymentStatus } from "@/server/services/payment.service";
import { paymentOrderParams, paymentStatusQuery } from "@/server/validation/payment";
import { parseParams, parseQuery } from "@/server/validation/request";

export const runtime = "nodejs";

/**
 * GET /api/v1/payments/:orderId/status[?refresh=1] — payment state of an order, for its owner.
 * `refresh=1` asks Razorpay first (e.g. after Checkout was closed or the connection dropped), so a
 * payment that went through is confirmed even without the browser callback.
 */
export const GET = withApi<{ orderId: string }>(async (req: NextRequest, { params }) => {
  const { refresh } = parseQuery(req, paymentStatusQuery);
  await enforceRateLimit(req, refresh ? "payment-status-refresh-ip" : "payment-status-ip", refresh ? 12 : 60, 60);
  const viewer = await orderViewer(req);
  const { orderId } = parseParams(params, paymentOrderParams);
  return ok(await getPaymentStatus(orderId, viewer, { refresh }), "Payment status");
});
