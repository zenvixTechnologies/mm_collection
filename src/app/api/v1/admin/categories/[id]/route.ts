import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { deleteCategory, updateCategory } from "@/server/services/admin-category.service";
import { cleanupImages } from "@/server/services/media.service";
import { categoryPatch, refParam } from "@/server/validation/admin-catalog";
import { parseBody, parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

type P = { id: string };

/** PATCH /api/v1/admin/categories/:id (slug or database ID). Slug and main category are fixed. */
export const PATCH = withApi<P>(async (req: NextRequest, { params }) => {
  const ctx = await requireAdmin(req, "categories:write");
  const { id } = parseParams(params, refParam);
  const { category, removedImage } = await updateCategory(id, await parseBody(req, categoryPatch), ctx.actor);
  if (removedImage) await cleanupImages([removedImage]);
  return ok(category, "Category updated successfully");
});

/** DELETE /api/v1/admin/categories/:id — refused while products use it. */
export const DELETE = withApi<P>(async (req: NextRequest, { params }) => {
  const ctx = await requireAdmin(req, "categories:write");
  const removed = await deleteCategory(parseParams(params, refParam).id, ctx.actor);
  if (removed.image) await cleanupImages([removed.image]);
  return ok({ deleted: removed.slug }, "Category deleted");
});
