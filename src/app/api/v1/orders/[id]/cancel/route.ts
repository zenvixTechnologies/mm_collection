import type { NextRequest } from "next/server";
import { requireCustomer } from "@/server/auth/customer-guard";
import { withApi } from "@/server/http/handler";
import { created } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { cancelByCustomer } from "@/server/services/after-sales.service";
import { cancelOrderBody } from "@/server/validation/after-sales";
import { orderParams } from "@/server/validation/checkout";
import { parseBody, parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

/** POST — { reason, otherReason?, details?, confirm: true }. The owner's paid order, before it ships. */
export const POST = withApi<{ id: string }>(async (req: NextRequest, { params }) => {
  const { userId } = await requireCustomer(req);
  await enforceRateLimit(req, "order-cancel", 10, 60, userId);
  const { id } = parseParams(params, orderParams);
  return created(await cancelByCustomer(userId, id, await parseBody(req, cancelOrderBody, { maxBytes: 8 * 1024 })), "Order cancelled");
});
