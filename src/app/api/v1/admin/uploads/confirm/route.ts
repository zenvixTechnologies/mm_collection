import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { confirmUpload } from "@/server/services/media.service";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

const body = z.object({ publicId: z.string().trim().min(1).max(300).regex(/^mm-collections\/[\w\-/]+$/) });

/** POST /api/v1/admin/uploads/confirm — verifies the upload with Cloudinary; rejects (and deletes) bad files. */
export const POST = withApi(async (req: NextRequest) => {
  const ctx = await requireAdmin(req, "uploads:write");
  const { publicId } = await parseBody(req, body, { maxBytes: 1024 });
  return ok(await confirmUpload(publicId, ctx.actor), "Image uploaded");
});
