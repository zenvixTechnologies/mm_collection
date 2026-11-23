import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { setLowStockThreshold } from "@/server/services/inventory.service";
import { thresholdBody } from "@/server/validation/admin-catalog";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

/** PATCH /api/v1/admin/inventory/threshold — a variant's low-stock alert level. */
export const PATCH = withApi(async (req: NextRequest) => {
  const ctx = await requireAdmin(req, "inventory:write");
  return ok(await setLowStockThreshold(await parseBody(req, thresholdBody), ctx.actor), "Alert level updated");
});
