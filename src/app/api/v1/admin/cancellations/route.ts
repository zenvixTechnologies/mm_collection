import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { adminListCancellations } from "@/server/services/after-sales.service";
import { cancellationListQuery } from "@/server/validation/after-sales";
import { parseQuery } from "@/server/validation/request";

export const runtime = "nodejs";

/* Returns and cancellations need payments:refund — held by Owner and Manager (who decide refunds), not Staff. */

/** GET /api/v1/admin/cancellations?page=&limit= — orders customers cancelled, with their reasons. */
export const GET = withApi(async (req: NextRequest) => {
  await requireAdmin(req, "payments:refund");
  const q = parseQuery(req, cancellationListQuery);
  const { items, meta } = await adminListCancellations(q.page, q.limit);
  return ok({ items, ...meta }, "Cancellations");
});
