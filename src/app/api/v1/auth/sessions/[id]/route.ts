import type { NextRequest } from "next/server";
import { requireCustomer } from "@/server/auth/customer-guard";
import { listActiveSessions, revokeSession } from "@/server/auth/session.service";
import { notFound } from "@/server/http/errors";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { addressIdParams } from "@/server/validation/customer-auth";
import { parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

/** DELETE /api/v1/auth/sessions/:id — sign out one of your own devices. */
export const DELETE = withApi<{ id: string }>(async (req: NextRequest, { params }) => {
  const { userId } = await requireCustomer(req);
  const { id } = parseParams(params, addressIdParams);
  const mine = await listActiveSessions("user", userId);
  // Only this customer's own sessions can be revoked.
  if (!mine.some((s) => s._id.toString() === id)) throw notFound("Session not found.");
  await revokeSession(id, "logout");
  return ok(null, "Device signed out");
});
