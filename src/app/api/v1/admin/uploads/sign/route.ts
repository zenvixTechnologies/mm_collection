import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { createUploadSignature } from "@/server/services/media.service";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

const body = z.object({
  purpose: z.enum(["product", "category", "banner", "logo"]),
  /** Product slug / ID — images are filed in that product's folder. */
  ref: z.string().trim().max(160).optional(),
});

/** POST /api/v1/admin/uploads/sign — signed parameters for one direct browser → Cloudinary upload. */
export const POST = withApi(async (req: NextRequest) => {
  const ctx = await requireAdmin(req, "uploads:write");
  const { purpose, ref } = await parseBody(req, body, { maxBytes: 1024 });
  return ok(await createUploadSignature(purpose, ref, ctx.actor), "Upload signed");
});
