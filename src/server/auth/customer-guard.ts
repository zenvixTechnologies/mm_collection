import "server-only";
import type { NextRequest } from "next/server";
import { connectToDatabase } from "@/server/db/connect";
import { AppError, forbidden } from "@/server/http/errors";
import { isSameOrigin } from "@/server/http/request-info";
import { User } from "@/server/models/user.model";
import { CUSTOMER_ACCESS_COOKIE } from "./cookies";
import { verifyAccessToken } from "./jwt";
import { getActiveSession } from "./session.service";

export interface CustomerContext {
  userId: string;
  sessionId: string;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Authenticates a customer request: same-origin for state changes → customer access token
 * (audience "customer" — admin tokens are rejected, and vice versa) → session still active →
 * account not blocked. Every customer endpoint calls this first; the user ID it returns is the
 * only one the endpoint may act on.
 */
export async function requireCustomer(req: NextRequest): Promise<CustomerContext> {
  if (!SAFE_METHODS.has(req.method) && !isSameOrigin(req)) {
    throw forbidden("This request was blocked for your security. Please reload the page and try again.");
  }
  const verified = await verifyAccessToken(req.cookies.get(CUSTOMER_ACCESS_COOKIE)?.value, "customer");
  if (!verified.ok) {
    throw verified.reason === "expired"
      ? new AppError(401, "TOKEN_EXPIRED", "Your session needs refreshing.")
      : new AppError(401, "UNAUTHORIZED", "Please log in to continue.");
  }
  const { sub, sid } = verified.claims;
  await connectToDatabase();
  const [session, user] = await Promise.all([getActiveSession(sid, "user", sub), User.findById(sub, { status: 1 }).lean()]);
  if (!session || !user) throw new AppError(401, "UNAUTHORIZED", "Please log in to continue.");
  if (user.status === "blocked") throw forbidden("This account has been suspended. Please contact us for help.");
  return { userId: sub, sessionId: sid };
}
