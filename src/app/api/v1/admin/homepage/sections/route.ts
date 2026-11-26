import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { setSectionVisibility } from "@/server/services/admin-homepage.service";
import { sectionBody } from "@/server/validation/admin-marketing";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

/** PATCH /api/v1/admin/homepage/sections — { key, visible }. */
export const PATCH = withApi(async (req: NextRequest) => {
  const ctx = await requireAdmin(req, "homepage:write");
  await enforceRateLimit(req, "admin-homepage-write", 60, 60, ctx.admin.id);
  return ok(await setSectionVisibility(await parseBody(req, sectionBody, { maxBytes: 1024 }), ctx.actor), "Section updated");
});
