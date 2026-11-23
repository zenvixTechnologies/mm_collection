import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { listInventory } from "@/server/services/inventory.service";
import { inventoryQuery } from "@/server/validation/admin-catalog";
import { parseQuery } from "@/server/validation/request";

export const runtime = "nodejs";

/** GET /api/v1/admin/inventory — one row per variant: on hand, reserved, available, alert level. */
export const GET = withApi(async (req: NextRequest) => {
  await requireAdmin(req, "inventory:read");
  return ok(await listInventory(parseQuery(req, inventoryQuery)), "Inventory");
});
