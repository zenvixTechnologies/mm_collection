import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { getEnv } from "@/server/config/env";
import { unauthorized } from "@/server/http/errors";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { expireUnpaidOrders } from "@/server/services/payment.service";
import { sweepDeferredRefunds } from "@/server/services/refund.service";
import { logger, serializeError } from "@/server/utils/logger";

export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH = 100;
/* Time budgets inside maxDuration: no new order is started after the first, no new refund after the second. */
const EXPIRY_BUDGET_MS = 30_000;
const TOTAL_BUDGET_MS = 45_000;

/**
 * GET /api/v1/cron/expire-orders — expires unpaid orders whose stock hold has run out, releasing
 * their reserved stock and coupon uses. Orders with payment attempts are checked with Razorpay
 * first: paid ones are completed instead, ones still processing are kept for a grace period.
 * Also retries saved early refunds whose payment is now on record. The two jobs are independent,
 * bounded and safe to repeat or run at the same time: what a run doesn't reach, a later one does.
 * Requires `Authorization: Bearer $CRON_SECRET`. Checkout also expires orders opportunistically.
 */
export const GET = withApi(async (req: NextRequest) => {
  const { CRON_SECRET } = getEnv("cron");
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${CRON_SECRET}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw unauthorized("Not allowed.");

  const started = Date.now();
  // A failure in either job never stops the other.
  const expiry = await expireUnpaidOrders({ limit: BATCH, deadline: started + EXPIRY_BUDGET_MS }).then(
    (result) => ({ ok: true as const, result }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  const refunds = await sweepDeferredRefunds({ limit: BATCH, deadline: started + TOTAL_BUDGET_MS }).catch((err: unknown) => {
    logger.error("cron.refund_sweep_failed", { error: serializeError(err) });
    return null;
  });
  logger.info("cron.expire_orders", { expiry: expiry.ok ? expiry.result : "failed", refunds: refunds ?? "failed", ms: Date.now() - started });
  if (!expiry.ok) throw expiry.error; // the run is reported as failed
  return ok(expiry.result, "Expired unpaid orders");
});
