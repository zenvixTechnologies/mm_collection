import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { created } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { createBanner } from "@/server/services/admin-homepage.service";
import { bannerCreateBody } from "@/server/validation/admin-marketing";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

/** POST /api/v1/admin/banners — the image must come from the admin upload flow (confirmed with Cloudinary). */
export const POST = withApi(async (req: NextRequest) => {
  const ctx = await requireAdmin(req, "homepage:write");
  await enforceRateLimit(req, "admin-homepage-write", 60, 60, ctx.admin.id);
  return created(await createBanner(await parseBody(req, bannerCreateBody, { maxBytes: 8 * 1024 }), ctx.actor), "Banner added");
});
