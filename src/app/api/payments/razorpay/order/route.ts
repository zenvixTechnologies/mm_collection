import { NextResponse } from "next/server";
import { STORE_CURRENCY } from "@/types";
import { quoteOrder, toPaise } from "@/lib/order-quote";
import { RazorpayError, getRazorpayConfig, razorpayRequest, type RazorpayOrder } from "@/lib/razorpay/server";
import { generateOrderId } from "@/lib/utils";
import { parseCheckoutInput } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Step 1 of checkout: validate the Indian delivery address, re-price the bag from the catalogue
 * and create a Razorpay order in INR. The browser never decides the amount.
 */
export async function POST(req: Request) {
  const config = getRazorpayConfig();
  if (!config) {
    return NextResponse.json({ error: "Online payments are not configured yet. Please try again later." }, { status: 503 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const details = parseCheckoutInput(body);
  if (!details.ok) {
    return NextResponse.json({ error: "Please check your delivery details.", fields: details.errors }, { status: 400 });
  }

  const quote = quoteOrder(body.items, body.couponCode);
  if (!quote.ok) return NextResponse.json({ error: quote.error }, { status: 409 });

  const receipt = generateOrderId();
  try {
    const order = await razorpayRequest<RazorpayOrder>(config, "/orders", {
      method: "POST",
      body: {
        amount: toPaise(quote.totals.total),
        currency: STORE_CURRENCY,
        receipt,
        notes: {
          store_order_id: receipt,
          country: "IN",
          state: details.address.state,
          pincode: details.address.pincode,
          coupon: quote.couponCode ?? "",
        },
      },
    });

    return NextResponse.json({
      orderId: receipt,
      razorpayOrderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: config.keyId,
      mode: config.mode,
      totals: quote.totals,
    });
  } catch (err) {
    console.error("[razorpay] order create failed", err);
    const status = err instanceof RazorpayError && err.status === 401 ? 503 : 502;
    return NextResponse.json({ error: "Could not start the payment. Please try again." }, { status });
  }
}
