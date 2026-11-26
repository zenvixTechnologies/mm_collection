import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/auth/guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { listCustomers } from "@/server/services/admin-customer.service";
import { customerListQuery } from "@/server/validation/admin-sales";
import { parseQuery } from "@/server/validation/request";

export const runtime = "nodejs";

/**
 * GET /api/v1/admin/customers?q=&status=&segment=&from=&to=&sort=&dir=&page=&limit=
 * Customer accounts with order count, net spend and last order (paid orders only).
 */
export const GET = withApi(async (req: NextRequest) => {
  await requireAdmin(req, "customers:read");
  const { items, meta, segments } = await listCustomers(parseQuery(req, customerListQuery));
  return ok({ items, ...meta, segments }, "Customers");
});
