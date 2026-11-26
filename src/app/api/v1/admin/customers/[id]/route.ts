import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { getCustomer, updateCustomer } from "@/server/services/admin-customer.service";
import { customerParams, customerUpdateBody } from "@/server/validation/admin-sales";
import { parseBody, parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

type P = { id: string };

/** GET /api/v1/admin/customers/:id — profile, addresses, figures and recent orders. */
export const GET = withApi<P>(async (req: NextRequest, { params }) => {
  await requireAdmin(req, "customers:read");
  return ok(await getCustomer(parseParams(params, customerParams).id), "Customer");
});

/** PATCH /api/v1/admin/customers/:id — { status?: "active" | "blocked", notes? } (audited). */
export const PATCH = withApi<P>(async (req: NextRequest, { params }) => {
  const ctx = await requireAdmin(req, "customers:write");
  await enforceRateLimit(req, "admin-customer-write", 60, 60, ctx.admin.id);
  const { id } = parseParams(params, customerParams);
  const body = await parseBody(req, customerUpdateBody, { maxBytes: 8 * 1024 });
  return ok(await updateCustomer(id, body, ctx.actor), "Customer updated");
});
