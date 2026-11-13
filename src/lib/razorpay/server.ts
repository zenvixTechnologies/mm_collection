/**
 * Razorpay helpers for API routes only — never import this from a client component:
 * it reads RAZORPAY_KEY_SECRET.
 *
 * Domestic (India-only) setup: every order is created in INR, and a payment is accepted only if
 * it was made in INR with UPI, an Indian card or net banking, and Razorpay does not flag it as
 * international.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.razorpay.com/v1";

export const ALLOWED_METHODS = ["upi", "card", "netbanking"] as const;
export type RazorpayMethod = (typeof ALLOWED_METHODS)[number];

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  mode: "test" | "live";
}

/**
 * Reads keys from the environment. Test keys start with `rzp_test_`, live keys with `rzp_live_`,
 * so switching to Live Mode after account approval only means swapping the two env vars.
 */
export function getRazorpayConfig(): RazorpayConfig | null {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret) return null;
  const mode = keyId.startsWith("rzp_live_") ? "live" : "test";
  return { keyId, keySecret, mode };
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
  init: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
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
