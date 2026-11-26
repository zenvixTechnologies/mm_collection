import type { NextRequest } from "next/server";
import { AppError } from "@/server/http/errors";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { handleWebhook } from "@/server/services/payment.service";

export const runtime = "nodejs";

const MAX_BYTES = 128 * 1024;

/**
 * POST /api/v1/payments/razorpay/webhook — Razorpay server-to-server events (payment.captured,
 * payment.authorized, payment.failed, order.paid). The body is read raw and its
 * X-Razorpay-Signature verified with RAZORPAY_WEBHOOK_SECRET before anything is parsed.
 * 200 = handled (or a duplicate safely ignored); 400 = bad signature; 5xx = Razorpay retries.
 */
export const POST = withApi(async (req: NextRequest) => {
  await enforceRateLimit(req, "razorpay-webhook-ip", 600, 60);
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new AppError(413, "PAYLOAD_TOO_LARGE", "Too large.");
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BYTES) throw new AppError(413, "PAYLOAD_TOO_LARGE", "Too large.");
  const result = await handleWebhook(raw, req.headers.get("x-razorpay-signature"), req.headers.get("x-razorpay-event-id"));
  return ok(result, "Webhook received");
});
