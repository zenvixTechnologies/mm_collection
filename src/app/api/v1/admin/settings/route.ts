import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { getSettings, updateSettings } from "@/server/services/admin-settings.service";
import { settingsUpdateBody } from "@/server/validation/admin-marketing";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

/**
 * GET /api/v1/admin/settings — store settings, shipping settings, payment gateway status (no
 * secrets) and the rules that are fixed (INR, India, no COD, "Shipping Charges Applicable").
 */
export const GET = withApi(async (req: NextRequest) => {
  await requireAdmin(req, "settings:read");
  return ok(await getSettings(), "Settings");
});

/** PATCH /api/v1/admin/settings — { version?, store?, social?, policies?, notifications?, seo? } (audited). */
export const PATCH = withApi(async (req: NextRequest) => {
  const ctx = await requireAdmin(req, "settings:write");
  await enforceRateLimit(req, "admin-settings-write", 30, 60, ctx.admin.id);
  return ok(await updateSettings(await parseBody(req, settingsUpdateBody, { maxBytes: 16 * 1024 }), ctx.actor), "Settings saved");
});
