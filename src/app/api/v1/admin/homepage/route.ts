import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { getHomepageAdmin } from "@/server/services/admin-homepage.service";

export const runtime = "nodejs";

/** GET /api/v1/admin/homepage — banners (all states), featured product IDs and section visibility. */
export const GET = withApi(async (req: NextRequest) => {
  await requireAdmin(req, "homepage:write");
  return ok(await getHomepageAdmin(), "Homepage");
});
