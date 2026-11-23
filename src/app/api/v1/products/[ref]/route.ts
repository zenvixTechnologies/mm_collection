import { withApi } from "@/server/http/handler";
import { PUBLIC_CATALOG_CACHE, ok } from "@/server/http/response";
import { getProductDetail } from "@/server/services/catalog.service";
import { productRef } from "@/server/validation/catalog";
import { parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

/** GET /api/v1/products/:ref — one product by slug, original ID (p001) or database ID, plus related products. */
export const GET = withApi<{ ref: string }>(async (_req, { params }) => {
  const { ref } = parseParams(params, productRef);
  return ok(await getProductDetail(ref), "Product", { headers: PUBLIC_CATALOG_CACHE });
});
