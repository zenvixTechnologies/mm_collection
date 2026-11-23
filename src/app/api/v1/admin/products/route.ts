import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { created, ok } from "@/server/http/response";
import { createProduct, listAdminProducts } from "@/server/services/admin-product.service";
import { productBody, productListQuery } from "@/server/validation/admin-catalog";
import { parseBody, parseQuery } from "@/server/validation/request";

export const runtime = "nodejs";

/** GET /api/v1/admin/products — every product (any status), filtered and paginated. */
export const GET = withApi(async (req: NextRequest) => {
  await requireAdmin(req, "products:read");
  const { items, meta } = await listAdminProducts(parseQuery(req, productListQuery));
  return ok(items, "Products", { meta: { pagination: meta } });
});

/** POST /api/v1/admin/products — create a product with its variants and opening stock. */
export const POST = withApi(async (req: NextRequest) => {
  const ctx = await requireAdmin(req, "products:write");
  const body = await parseBody(req, productBody, { maxBytes: 256 * 1024 });
  return created(await createProduct(body, ctx.actor), "Product created successfully");
});
