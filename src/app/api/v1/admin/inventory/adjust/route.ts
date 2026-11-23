import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { adjustStock } from "@/server/services/inventory.service";
import { inventoryAdjustBody } from "@/server/validation/admin-catalog";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

/** POST /api/v1/admin/inventory/adjust — add / remove / set a variant's stock, with a reason. */
export const POST = withApi(async (req: NextRequest) => {
  const ctx = await requireAdmin(req, "inventory:write");
  const item = await adjustStock(await parseBody(req, inventoryAdjustBody), ctx.actor);
  return ok(item, "Stock updated");
});
