import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { deleteBanner, updateBanner } from "@/server/services/admin-homepage.service";
import { bannerParams, bannerUpdateBody } from "@/server/validation/admin-marketing";
import { parseBody, parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

type P = { id: string };

/** PATCH /api/v1/admin/banners/:id — partial update; a replaced Cloudinary image is deleted once unused. */
export const PATCH = withApi<P>(async (req: NextRequest, { params }) => {
  const ctx = await requireAdmin(req, "homepage:write");
  await enforceRateLimit(req, "admin-homepage-write", 60, 60, ctx.admin.id);
  const { id } = parseParams(params, bannerParams);
  return ok(await updateBanner(id, await parseBody(req, bannerUpdateBody, { maxBytes: 8 * 1024 }), ctx.actor), "Banner updated");
});

/** DELETE /api/v1/admin/banners/:id — also deletes its Cloudinary image once nothing uses it. */
export const DELETE = withApi<P>(async (req: NextRequest, { params }) => {
  const ctx = await requireAdmin(req, "homepage:write");
  await enforceRateLimit(req, "admin-homepage-write", 60, 60, ctx.admin.id);
  return ok(await deleteBanner(parseParams(params, bannerParams).id, ctx.actor), "Banner deleted");
});
