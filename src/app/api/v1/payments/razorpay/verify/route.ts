import type { NextRequest } from "next/server";
import { withApi } from "@/server/http/handler";
import { orderViewer } from "@/server/http/order-viewer";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { verifyCheckoutPayment } from "@/server/services/payment.service";
import { verifyPaymentBody } from "@/server/validation/payment";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

/**
 * POST /api/v1/payments/razorpay/verify — Razorpay Checkout's success callback:
 * { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature }. The signature is checked
 * with the server-side secret and the payment is re-read from Razorpay before the order is marked
 * paid. Returns { result: "paid" | "processing" | "failed", order }. Repeating it is harmless.
 */
export const POST = withApi(async (req: NextRequest) => {
  await enforceRateLimit(req, "payment-verify-ip", 30, 60);
  const viewer = await orderViewer(req);
  const { orderId, ...callback } = await parseBody(req, verifyPaymentBody, { maxBytes: 2048 });
  return ok(await verifyCheckoutPayment(orderId, viewer, callback), "Payment checked");
});
