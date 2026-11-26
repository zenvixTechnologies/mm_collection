import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { getEnv } from "@/server/config/env";
import { unauthorized } from "@/server/http/errors";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { expireStaleOrders } from "@/server/services/order.service";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/v1/cron/expire-orders — expires unpaid orders whose stock hold has run out, releasing
 * their reserved stock and coupon uses. Requires `Authorization: Bearer $CRON_SECRET`. Checkout
 * also does this opportunistically, so a missed run only delays the release.
 */
export const GET = withApi(async (req: NextRequest) => {
  const { CRON_SECRET } = getEnv("cron");
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${CRON_SECRET}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw unauthorized("Not allowed.");
  return ok(await expireStaleOrders({ limit: 200 }), "Expired unpaid orders");
});
