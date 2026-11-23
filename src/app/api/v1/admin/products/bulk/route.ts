import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { deleteProducts, setProductsStatus } from "@/server/services/admin-product.service";
import { cleanupImages } from "@/server/services/media.service";
import { bulkProductsBody } from "@/server/validation/admin-catalog";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

/** POST /api/v1/admin/products/bulk — { action: "status", ids, status } or { action: "delete", ids }. */
export const POST = withApi(async (req: NextRequest) => {
  const body = await parseBody(req, bulkProductsBody);
  if (body.action === "delete") {
    const ctx = await requireAdmin(req, "products:delete");
    const { deleted, images } = await deleteProducts(body.ids, ctx.actor);
    await cleanupImages(images);
    return ok({ deleted }, `Deleted ${deleted.length} product${deleted.length === 1 ? "" : "s"}`);
  }
  const ctx = await requireAdmin(req, "products:write");
  const result = await setProductsStatus(body.ids, body.status, ctx.actor);
  return ok(result, `Updated ${result.updated.length} product${result.updated.length === 1 ? "" : "s"}`);
});
