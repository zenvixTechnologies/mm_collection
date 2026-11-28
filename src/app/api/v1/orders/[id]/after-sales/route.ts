import type { NextRequest } from "next/server";
import { requireCustomer } from "@/server/auth/customer-guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { getAfterSales } from "@/server/services/after-sales.service";
import { orderParams } from "@/server/validation/checkout";
import { parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

/** GET — the signed-in owner's cancel and return options, requests and refund progress. */
export const GET = withApi<{ id: string }>(async (req: NextRequest, { params }) => {
  const { userId } = await requireCustomer(req);
  await enforceRateLimit(req, "after-sales-read", 120, 60, userId);
  const { id } = parseParams(params, orderParams);
  return ok(await getAfterSales(userId, id), "Order options");
});
