import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { setFeaturedProducts } from "@/server/services/admin-homepage.service";
import { featuredBody } from "@/server/validation/admin-marketing";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

/** PUT /api/v1/admin/homepage/featured — { productIds } in display order (active products, up to 8). */
export const PUT = withApi(async (req: NextRequest) => {
  const ctx = await requireAdmin(req, "homepage:write");
  await enforceRateLimit(req, "admin-homepage-write", 60, 60, ctx.admin.id);
  return ok(await setFeaturedProducts(await parseBody(req, featuredBody, { maxBytes: 4096 }), ctx.actor), "Featured products updated");
});
