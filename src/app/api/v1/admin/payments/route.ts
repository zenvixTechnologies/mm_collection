import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { listPayments } from "@/server/services/admin-payment.service";
import { paymentListQuery } from "@/server/validation/admin-sales";
import { parseQuery } from "@/server/validation/request";

export const runtime = "nodejs";

/**
 * GET /api/v1/admin/payments?q=&status=&group=&method=&mode=&from=&to=&sort=&dir=&page=&limit=
 * Razorpay payment attempts with order and customer, plus headline figures.
 */
export const GET = withApi(async (req: NextRequest) => {
  await requireAdmin(req, "payments:read");
  const { items, meta, summary } = await listPayments(parseQuery(req, paymentListQuery));
  return ok({ items, ...meta, summary }, "Payments");
});
