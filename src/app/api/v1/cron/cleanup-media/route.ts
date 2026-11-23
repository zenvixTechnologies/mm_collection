import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { getEnv } from "@/server/config/env";
import { unauthorized } from "@/server/http/errors";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { cleanupOrphanImages } from "@/server/services/media.service";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/v1/cron/cleanup-media — Vercel Cron (see vercel.json). Deletes images uploaded more
 * than 24 hours ago that no product, category or banner uses. Requires `Authorization: Bearer
 * $CRON_SECRET`.
 */
export const GET = withApi(async (req: NextRequest) => {
  const { CRON_SECRET } = getEnv("cron");
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${CRON_SECRET}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw unauthorized("Not allowed.");
  return ok(await cleanupOrphanImages(), "Orphan image cleanup finished");
});
