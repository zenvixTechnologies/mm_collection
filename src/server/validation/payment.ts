import "server-only";
import { z } from "zod";
import { orderNumber } from "./checkout";

/**
 * Payment request bodies. No amount, currency or status is ever accepted from the browser —
 * only which order, and (after Checkout) the IDs and signature Razorpay handed to the browser.
 */

const razorpayId = (prefix: "order" | "pay") =>
  z.string().trim().regex(new RegExp(`^${prefix}_[A-Za-z0-9]{6,40}$`), "Invalid payment reference.");

export const startPaymentBody = z.object({ orderId: orderNumber });

export const verifyPaymentBody = z.object({
  orderId: orderNumber,
  razorpay_order_id: razorpayId("order"),
  razorpay_payment_id: razorpayId("pay"),
  razorpay_signature: z.string().trim().regex(/^[a-f0-9]{64}$/i, "Invalid payment signature."),
});

export const paymentOrderParams = z.object({ orderId: orderNumber });

export const paymentStatusQuery = z.object({
  refresh: z
    .enum(["1", "true", "0", "false"])
    .optional()
    .transform((v) => v === "1" || v === "true"),
});
