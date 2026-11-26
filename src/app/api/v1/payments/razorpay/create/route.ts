import type { NextRequest } from "next/server";
import { withApi } from "@/server/http/handler";
import { orderViewer } from "@/server/http/order-viewer";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { startPayment } from "@/server/services/payment.service";
import { startPaymentBody } from "@/server/validation/payment";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

/**
 * POST /api/v1/payments/razorpay/create — { orderId } → what Razorpay Checkout needs to pay that
 * order (public Key ID, Razorpay order ID, the stored total in paise, INR). Only the order's owner
 * (customer session or guest X-Order-Token) may call it; the amount is never taken from the
 * request. Repeated calls return the same unpaid attempt.
 */
export const POST = withApi(async (req: NextRequest) => {
  await enforceRateLimit(req, "payment-create-ip", 30, 60);
  const viewer = await orderViewer(req);
  const { orderId } = await parseBody(req, startPaymentBody, { maxBytes: 1024 });
  return ok(await startPayment(orderId, viewer, { retry: false }), "Payment ready");
});
