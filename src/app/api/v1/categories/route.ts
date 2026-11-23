import { withApi } from "@/server/http/handler";
import { PUBLIC_CATALOG_CACHE, ok } from "@/server/http/response";
import { listCategories } from "@/server/services/catalog.service";
import { categoryListQuery } from "@/server/validation/catalog";
import { parseQuery } from "@/server/validation/request";

export const runtime = "nodejs";

/** GET /api/v1/categories?audience=women — visible categories in display order. */
export const GET = withApi(async (req) => {
  const { audience } = parseQuery(req, categoryListQuery);
  return ok(await listCategories(audience), "Categories", { headers: PUBLIC_CATALOG_CACHE });
});
