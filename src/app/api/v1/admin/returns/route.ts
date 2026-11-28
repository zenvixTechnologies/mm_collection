import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { adminListReturns } from "@/server/services/after-sales.service";
import { returnListQuery } from "@/server/validation/after-sales";
import { parseQuery } from "@/server/validation/request";

export const runtime = "nodejs";

/* Returns and cancellations need payments:refund — held by Owner and Manager (who decide refunds), not Staff. */

/** GET /api/v1/admin/returns?status=&order=&page=&limit= */
export const GET = withApi(async (req: NextRequest) => {
  await requireAdmin(req, "payments:refund");
  const { items, meta } = await adminListReturns(parseQuery(req, returnListQuery));
  return ok({ items, ...meta }, "Return requests");
});
