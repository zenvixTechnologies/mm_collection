import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";

export const runtime = "nodejs";

/** GET /api/v1/admin/auth/me — the signed-in admin, their role and permissions. */
export const GET = withApi(async (req: NextRequest) => {
  const { admin } = await requireAdmin(req);
  return ok({ admin }, "Signed in");
});
