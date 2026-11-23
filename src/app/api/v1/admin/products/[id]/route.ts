import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { deleteProducts, getAdminProduct, updateProduct } from "@/server/services/admin-product.service";
import { cleanupImages } from "@/server/services/media.service";
import { productBody, refParam } from "@/server/validation/admin-catalog";
import { parseBody, parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

type P = { id: string };

/** GET /api/v1/admin/products/:id (original ID, slug or database ID). */
export const GET = withApi<P>(async (req: NextRequest, { params }) => {
  await requireAdmin(req, "products:read");
  return ok(await getAdminProduct(parseParams(params, refParam).id), "Product");
});

/** PUT /api/v1/admin/products/:id — replace details and variant list (stock is untouched). */
export const PUT = withApi<P>(async (req: NextRequest, { params }) => {
  const ctx = await requireAdmin(req, "products:write");
  const { id } = parseParams(params, refParam);
  const body = await parseBody(req, productBody, { maxBytes: 256 * 1024 });
  const { product, removedImages } = await updateProduct(id, body, ctx.actor);
  await cleanupImages(removedImages);
  return ok(product, "Product updated successfully");
});

/** DELETE /api/v1/admin/products/:id */
export const DELETE = withApi<P>(async (req: NextRequest, { params }) => {
  const ctx = await requireAdmin(req, "products:delete");
  const { deleted, images } = await deleteProducts([parseParams(params, refParam).id], ctx.actor);
  await cleanupImages(images);
  return ok({ deleted }, "Product deleted");
});
