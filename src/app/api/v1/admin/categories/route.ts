import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { created, ok } from "@/server/http/response";
import { createCategory, listAdminCategories } from "@/server/services/admin-category.service";
import { categoryBody } from "@/server/validation/admin-catalog";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

/** GET /api/v1/admin/categories — all categories (including hidden) with product counts. */
export const GET = withApi(async (req: NextRequest) => {
  await requireAdmin(req, "categories:read");
  return ok(await listAdminCategories(), "Categories");
});

/** POST /api/v1/admin/categories */
export const POST = withApi(async (req: NextRequest) => {
  const ctx = await requireAdmin(req, "categories:write");
  return created(await createCategory(await parseBody(req, categoryBody), ctx.actor), "Category created successfully");
});
