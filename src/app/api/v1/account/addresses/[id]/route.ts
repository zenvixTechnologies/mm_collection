import type { NextRequest } from "next/server";
import { requireCustomer } from "@/server/auth/customer-guard";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { deleteAddress, updateAddress } from "@/server/services/address.service";
import { addressBody, addressIdParams } from "@/server/validation/customer-auth";
import { parseBody, parseParams } from "@/server/validation/request";

export const runtime = "nodejs";

type P = { id: string };

/** PUT /api/v1/account/addresses/:id */
export const PUT = withApi<P>(async (req: NextRequest, { params }) => {
  const { userId } = await requireCustomer(req);
  const { id } = parseParams(params, addressIdParams);
  return ok(await updateAddress(userId, id, await parseBody(req, addressBody, { maxBytes: 4096 })), "Address updated");
});

/** DELETE /api/v1/account/addresses/:id */
export const DELETE = withApi<P>(async (req: NextRequest, { params }) => {
  const { userId } = await requireCustomer(req);
  return ok(await deleteAddress(userId, parseParams(params, addressIdParams).id), "Address removed");
});
