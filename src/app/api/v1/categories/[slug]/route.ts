import { withApi } from "@/server/http/handler";
import { PUBLIC_CATALOG_CACHE, ok } from "@/server/http/response";
import { getCategoryDetail } from "@/server/services/catalog.service";
import { categoryRef } from "@/server/validation/catalog";
import { parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

/** GET /api/v1/categories/:slug — one category with its product count. */
export const GET = withApi<{ slug: string }>(async (_req, { params }) => {
  const { slug } = parseParams(params, categoryRef);
  return ok(await getCategoryDetail(slug), "Category", { headers: PUBLIC_CATALOG_CACHE });
});
