import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { bulkUpdateStatus } from "@/server/services/admin-order.service";
import { bulkOrderStatusBody } from "@/server/validation/admin-sales";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

/**
 * POST /api/v1/admin/orders/bulk-status — { ids: orderNumbers[], status }. Each order is checked
 * on its own (same rules as a single update); the response lists what was updated and skipped.
 */
export const POST = withApi(async (req: NextRequest) => {
  const ctx = await requireAdmin(req, "orders:write");
  await enforceRateLimit(req, "admin-order-bulk", 20, 60, ctx.admin.id);
  const body = await parseBody(req, bulkOrderStatusBody, { maxBytes: 8 * 1024 });
  return ok(await bulkUpdateStatus(body, ctx.actor), "Bulk update finished");
});
