import { withApi } from "@/server/http/handler";
import { PUBLIC_CATALOG_CACHE, ok } from "@/server/http/response";
import { listProducts } from "@/server/services/catalog.service";
import { productListQuery } from "@/server/validation/catalog";
import { parseQuery } from "@/server/validation/request";

export const runtime = "nodejs";

/**
 * GET /api/v1/products — search, filter, sort and paginate active products.
 * Query: q, audience, category, minPrice, maxPrice (rupees), minDiscount, inStock, featured,
 * newArrival, bestSeller, sizes, colors, sort, page, limit.
 */
export const GET = withApi(async (req) => {
  const { items, meta } = await listProducts(parseQuery(req, productListQuery));
  return ok(items, "Products", { meta: { pagination: meta }, headers: PUBLIC_CATALOG_CACHE });
});
