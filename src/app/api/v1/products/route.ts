import { withApi } from "@/server/http/handler";
import { PUBLIC_LISTING_CACHE, ok } from "@/server/http/response";
import { listProducts } from "@/server/services/catalog.service";
import { productListQuery } from "@/server/validation/catalog";
import { parseQuery } from "@/server/validation/request";

export const runtime = "nodejs";

/**
 * GET /api/v1/products — search, filter, sort and paginate active products.
 * Query: q, search, audience, category (one or more), minPrice, maxPrice (rupees), minDiscount,
 * inStock, featured, newArrival, bestSeller, sizes, colors, sort, page, limit, facets.
 * `data` is the page of products and `meta.pagination` counts every match. With facets=true,
 * `meta.filters` holds the applied filters and the options available for this listing.
 */
export const GET = withApi(async (req) => {
  const query = parseQuery(req, productListQuery);
  const { items, meta, facets } = await listProducts(query);
  const { page: _page, limit: _limit, facets: _facets, ...applied } = query;
  void [_page, _limit, _facets];
  return ok(items, "Products", {
    meta: { pagination: meta, ...(facets && { filters: { applied, available: facets } }) },
    // The cache key is the full URL, so each filter, sort and page combination is cached apart.
    headers: PUBLIC_LISTING_CACHE,
  });
});
