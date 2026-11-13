import { NextResponse } from "next/server";
import { STORE_CURRENCY, type PaymentMethod, type PaymentRecord } from "@/types";
import { quoteOrder, toPaise } from "@/lib/order-quote";
import {
  checkDomesticPayment,
  getRazorpayConfig,
  razorpayRequest,
  verifyPaymentSignature,
  type RazorpayOrder,
  type RazorpayPayment,
} from "@/lib/razorpay/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 200) : "");

/**
 * Step 2 of checkout: after Razorpay Checkout succeeds, verify the signature with our secret,
 * fetch the order and payment from Razorpay, and confirm it is a domestic INR payment for the
 * exact server-computed amount. Only then is the order confirmed.
 */
export async function POST(req: Request) {
  const config = getRazorpayConfig();
  if (!config) return NextResponse.json({ error: "Online payments are not configured." }, { status: 503 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const orderId = str(body.razorpay_order_id);
  const paymentId = str(body.razorpay_payment_id);
  const signature = str(body.razorpay_signature);
  if (!verifyPaymentSignature(orderId, paymentId, signature, config.keySecret)) {
    return NextResponse.json({ error: "Payment verification failed." }, { status: 400 });
  }

  try {
    const [order, payment] = await Promise.all([
      razorpayRequest<RazorpayOrder>(config, `/orders/${encodeURIComponent(orderId)}`),
      razorpayRequest<RazorpayPayment>(config, `/payments/${encodeURIComponent(paymentId)}`),
    ]);

    const problem = checkDomesticPayment(payment, order);
    if (problem) {
      console.warn("[razorpay] rejected payment", paymentId, problem);
      return NextResponse.json({ error: problem }, { status: 400 });
    }

    // Re-price the same bag; it must match what Razorpay charged (which we set in step 1).
    const quote = quoteOrder(body.items, body.couponCode);
    if (!quote.ok || toPaise(quote.totals.total) !== order.amount) {
      console.error("[razorpay] amount mismatch", { orderId, paymentId, amount: order.amount });
      return NextResponse.json(
        { error: `Your payment could not be matched to your bag. Please contact us with payment ID ${paymentId}.` },
        { status: 409 },
      );
    }

    // Accounts with auto-capture enabled arrive as "captured"; otherwise capture now.
    if (payment.status === "authorized") {
      await razorpayRequest(config, `/payments/${encodeURIComponent(paymentId)}/capture`, {
        method: "POST",
        body: { amount: order.amount, currency: STORE_CURRENCY },
      });
    }

    const record: PaymentRecord = {
      provider: "razorpay",
      mode: config.mode,
      razorpayOrderId: order.id,
      razorpayPaymentId: payment.id,
      currency: STORE_CURRENCY,
      amount: order.amount / 100,
    };

    return NextResponse.json({
      ok: true,
      orderId: order.receipt,
      paymentMethod: payment.method as PaymentMethod,
      payment: record,
      items: quote.items,
      totals: quote.totals,
      couponCode: quote.couponCode,
    });
  } catch (err) {
    console.error("[razorpay] verify failed", err);
    return NextResponse.json(
      { error: `We couldn't confirm your payment yet. Please contact us with payment ID ${paymentId}.` },
      { status: 502 },
    );
  }
}
