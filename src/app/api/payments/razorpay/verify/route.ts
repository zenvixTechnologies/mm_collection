import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Retired. This endpoint priced the bag from product-level catalogue data. Payments now run only
 * against stored orders, for the total saved on the order:
 *   POST /api/v1/payments/razorpay/create · POST /api/v1/payments/razorpay/verify
 */
export function POST() {
  return NextResponse.json(
    { success: false, message: "This payment endpoint has been replaced. Please refresh the page and try again.", error: { code: "GONE" } },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
