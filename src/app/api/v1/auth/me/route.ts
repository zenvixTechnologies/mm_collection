import type { NextRequest } from "next/server";
import { requireCustomer } from "@/server/auth/customer-guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { getCustomer, updateCustomerProfile } from "@/server/services/customer-auth.service";
import { profilePatchBody } from "@/server/validation/customer-auth";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

/** GET /api/v1/auth/me — the signed-in customer with saved addresses. */
export const GET = withApi(async (req: NextRequest) => {
  const { userId } = await requireCustomer(req);
  return ok({ user: await getCustomer(userId) }, "Signed in");
});

/** PATCH /api/v1/auth/me — update name, mobile, marketing preference, or email (needs current password). */
export const PATCH = withApi(async (req: NextRequest) => {
  const { userId } = await requireCustomer(req);
  const patch = await parseBody(req, profilePatchBody, { maxBytes: 4096 });
  return ok({ user: await updateCustomerProfile(userId, patch) }, "Profile updated");
});
