import { NextResponse, type NextRequest } from "next/server";
import { requireCustomer } from "@/server/auth/customer-guard";
import { clearCustomerAuthCookies } from "@/server/auth/customer-cookies";
import { revokeAllSessions } from "@/server/auth/session.service";
import { withApi } from "@/server/http/handler";

export const runtime = "nodejs";

/** POST /api/v1/auth/logout-all — sign out on every device. */
export const POST = withApi(async (req: NextRequest) => {
  const { userId } = await requireCustomer(req);
  const count = await revokeAllSessions("user", userId, "logout_all");
  const res = NextResponse.json({ success: true, message: `Logged out of ${count} device${count === 1 ? "" : "s"}`, data: { count } });
  return clearCustomerAuthCookies(res);
});
