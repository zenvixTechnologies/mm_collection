import type { NextRequest } from "next/server";
import { requireCustomer } from "@/server/auth/customer-guard";
import { withApi } from "@/server/http/handler";
import { created, ok } from "@/server/http/response";
import { addAddress, listAddresses } from "@/server/services/address.service";
import { addressBody } from "@/server/validation/customer-auth";
import { parseBody } from "@/server/validation/request";

export const runtime = "nodejs";

/** GET /api/v1/account/addresses — the signed-in customer's saved addresses (default first). */
export const GET = withApi(async (req: NextRequest) => {
  const { userId } = await requireCustomer(req);
  return ok(await listAddresses(userId), "Addresses");
});

/** POST /api/v1/account/addresses — save an Indian delivery address. */
export const POST = withApi(async (req: NextRequest) => {
  const { userId } = await requireCustomer(req);
  return created(await addAddress(userId, await parseBody(req, addressBody, { maxBytes: 4096 })), "Address saved");
});
