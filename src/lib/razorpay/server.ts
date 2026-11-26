/**
 * Razorpay helpers for API routes only — never import this from a client component:
 * it reads RAZORPAY_KEY_SECRET.
 *
 * Domestic (India-only) setup: every order is created in INR, and a payment is accepted only if
 * it was made in INR with UPI, an Indian card or net banking, and Razorpay does not flag it as
 * international.
 */
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv, isConfigured } from "@/server/config/env";

const API = "https://api.razorpay.com/v1";

export const ALLOWED_METHODS = ["upi", "card", "netbanking"] as const;
export type RazorpayMethod = (typeof ALLOWED_METHODS)[number];

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  mode: "test" | "live";
}

/**
 * Validated keys (src/server/config/env.ts). Test keys start with `rzp_test_`, live keys with
 * `rzp_live_`; live keys are refused unless RAZORPAY_ALLOW_LIVE=true. Throws ConfigError (→ 503,
 * variable names logged, never values) when keys are missing or invalid.
 */
export function razorpayConfig(): RazorpayConfig {
  const env = getEnv("razorpay");
  const keyId = env.RAZORPAY_KEY_ID.trim();
  return { keyId, keySecret: env.RAZORPAY_KEY_SECRET.trim(), mode: keyId.startsWith("rzp_live_") ? "live" : "test" };
}

/** Same as razorpayConfig(), but null instead of throwing when payments aren't configured. */
export function getRazorpayConfig(): RazorpayConfig | null {
  return isConfigured("razorpay") ? razorpayConfig() : null;
}

/** RAZORPAY_WEBHOOK_SECRET (throws ConfigError when unset). */
export function webhookSecret() {
  return getEnv("razorpayWebhook").RAZORPAY_WEBHOOK_SECRET;
}

export class RazorpayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function razorpayRequest<T>(
  config: RazorpayConfig,
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
    // Never hang a request (or a checkout) on a slow gateway.
    signal: AbortSignal.timeout(init.timeoutMs ?? 10_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { description?: string } };
  if (!res.ok) throw new RazorpayError(data.error?.description ?? `Razorpay request failed (${res.status})`, res.status);
  return data;
}

/** Razorpay's checkout signature: HMAC-SHA256(order_id + "|" + payment_id, key_secret), hex. */
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string, secret: string) {
  if (!orderId || !paymentId || !signature) return false;
  const expected = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Webhook signature: HMAC-SHA256(raw request body, webhook secret), hex, sent as
 * X-Razorpay-Signature. Must be computed over the exact bytes received — before JSON parsing.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null, secret: string) {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody, "utf8").digest("hex"), "utf8");
  const given = Buffer.from(signature.toLowerCase(), "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string | null;
  status: string;
  notes: Record<string, string> | [];
}

export interface RazorpayPayment {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
  method: string;
  international: boolean;
  captured: boolean;
  error_code?: string | null;
  error_description?: string | null;
  error_reason?: string | null;
  bank?: string | null;
  wallet?: string | null;
  vpa?: string | null;
  card?: { network?: string | null; type?: string | null } | null;
  fee?: number | null;
  tax?: number | null;
  created_at?: number;
}

/** Checks that a fetched payment is a domestic INR payment for this order. Returns an error message or null. */
export function checkDomesticPayment(payment: RazorpayPayment, order: RazorpayOrder): string | null {
  if (payment.order_id !== order.id) return "Payment does not belong to this order.";
  if (payment.currency !== "INR" || order.currency !== "INR") return "Only payments in Indian Rupees (INR) are accepted.";
  if (payment.international) return "International payments are not accepted. Please pay with UPI, an Indian card or net banking.";
  if (!(ALLOWED_METHODS as readonly string[]).includes(payment.method)) {
    return "This payment method is not supported. Please pay with UPI, an Indian card or net banking.";
  }
  if (payment.amount !== order.amount) return "Paid amount does not match the order amount.";
  if (payment.status !== "captured" && payment.status !== "authorized") return "Payment was not completed.";
  return null;
}
