import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { moveBanner } from "@/server/services/admin-homepage.service";
import { bannerMoveBody, bannerParams } from "@/server/validation/admin-marketing";
import { parseBody, parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

/** POST /api/v1/admin/banners/:id/move — { direction: -1 | 1 } within its placement. */
export const POST = withApi<{ id: string }>(async (req: NextRequest, { params }) => {
  const ctx = await requireAdmin(req, "homepage:write");
  await enforceRateLimit(req, "admin-homepage-write", 60, 60, ctx.admin.id);
  const { id } = parseParams(params, bannerParams);
  const { direction } = await parseBody(req, bannerMoveBody, { maxBytes: 256 });
  return ok(await moveBanner(id, direction, ctx.actor), "Banner moved");
});
