import type { NextRequest } from "next/server";
import { requireCustomer } from "@/server/auth/customer-guard";
import { withApi } from "@/server/http/handler";
import { created } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { createReturnRequest } from "@/server/services/after-sales.service";
import { returnRequestBody } from "@/server/validation/after-sales";
import { orderParams } from "@/server/validation/checkout";
import { parseBody, parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

/** POST — { itemId, quantity, reason, explanation?, comments?, confirm: true } for a delivered order. */
export const POST = withApi<{ id: string }>(async (req: NextRequest, { params }) => {
  const { userId } = await requireCustomer(req);
  await enforceRateLimit(req, "return-request", 10, 60, userId);
  const { id } = parseParams(params, orderParams);
  return created(await createReturnRequest(userId, id, await parseBody(req, returnRequestBody, { maxBytes: 8 * 1024 })), "Return requested");
});
