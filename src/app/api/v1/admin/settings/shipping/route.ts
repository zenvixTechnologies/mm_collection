import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { updateShipping } from "@/server/services/admin-settings.service";
import { shippingUpdateBody } from "@/server/validation/admin-marketing";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

/**
 * PATCH /api/v1/admin/settings/shipping — delivery text and courier partners. The shipping-charge
 * notice ("Shipping Charges Applicable") and India-only delivery can't be changed.
 */
export const PATCH = withApi(async (req: NextRequest) => {
  const ctx = await requireAdmin(req, "shipping:write");
  await enforceRateLimit(req, "admin-settings-write", 30, 60, ctx.admin.id);
  return ok(await updateShipping(await parseBody(req, shippingUpdateBody, { maxBytes: 16 * 1024 }), ctx.actor), "Shipping settings saved");
});
