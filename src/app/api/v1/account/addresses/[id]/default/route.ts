import type { NextRequest } from "next/server";
import { requireCustomer } from "@/server/auth/customer-guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { setDefaultAddress } from "@/server/services/address.service";
import { addressIdParams } from "@/server/validation/customer-auth";
import { parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

/** POST /api/v1/account/addresses/:id/default — make this the default delivery address. */
export const POST = withApi<{ id: string }>(async (req: NextRequest, { params }) => {
  const { userId } = await requireCustomer(req);
  return ok(await setDefaultAddress(userId, parseParams(params, addressIdParams).id), "Default address updated");
});
