import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { listMovements } from "@/server/services/inventory.service";
import { movementsQuery } from "@/server/validation/admin-catalog";
import { parseQuery } from "@/server/validation/request";

export const runtime = "nodejs";

/** GET /api/v1/admin/inventory/movements — recent stock ledger entries (manual changes). */
export const GET = withApi(async (req: NextRequest) => {
  await requireAdmin(req, "inventory:read");
  return ok(await listMovements(parseQuery(req, movementsQuery)), "Stock movements");
});
