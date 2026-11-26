import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { getEnv } from "@/server/config/env";
import { unauthorized } from "@/server/http/errors";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { expireUnpaidOrders } from "@/server/services/payment.service";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/v1/cron/expire-orders — expires unpaid orders whose stock hold has run out, releasing
 * their reserved stock and coupon uses. Orders with payment attempts are checked with Razorpay
 * first: paid ones are completed instead, ones still processing are kept for a grace period.
 * Requires `Authorization: Bearer $CRON_SECRET`. Checkout also does this opportunistically.
 */
export const GET = withApi(async (req: NextRequest) => {
  const { CRON_SECRET } = getEnv("cron");
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${CRON_SECRET}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw unauthorized("Not allowed.");
  return ok(await expireUnpaidOrders({ limit: 100 }), "Expired unpaid orders");
});
