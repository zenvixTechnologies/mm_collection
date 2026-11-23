import { isConfigured } from "@/server/config/env";
import { pingDatabase } from "@/server/db/connect";
import { withApi } from "@/server/http/handler";
import { fail, ok } from "@/server/http/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/health — liveness + database reachability for uptime monitors.
 * Reports only up / down / not_configured; never connection details.
 */
export const GET = withApi(async (_req, { requestId }) => {
  if (!isConfigured("database")) {
    return fail(503, "SERVICE_UNAVAILABLE", "Database is not configured.", { requestId });
  }
  let up = false;
  try {
    up = await pingDatabase();
  } catch {
    up = false;
  }
  return up
    ? ok({ status: "ok", database: "up", time: new Date().toISOString() }, "Healthy")
    : fail(503, "DATABASE_UNAVAILABLE", "Database is unreachable.", { requestId });
});
