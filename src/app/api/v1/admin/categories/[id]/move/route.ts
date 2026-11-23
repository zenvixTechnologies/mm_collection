import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { moveCategory } from "@/server/services/admin-category.service";
import { categoryMoveBody, refParam } from "@/server/validation/admin-catalog";
import { parseBody, parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

/** POST /api/v1/admin/categories/:id/move — { direction: -1 | 1 }; returns the reordered list. */
export const POST = withApi<{ id: string }>(async (req: NextRequest, { params }) => {
  const ctx = await requireAdmin(req, "categories:write");
  const { direction } = await parseBody(req, categoryMoveBody);
  return ok(await moveCategory(parseParams(params, refParam).id, direction, ctx.actor), "Category moved");
});
