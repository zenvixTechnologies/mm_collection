import "server-only";
import { decodeJwt, jwtVerify } from "jose";
import { getEnv } from "@/server/config/env";

/**
 * Session id from a correctly signed admin token even if it has expired — used only so that
 * signing out always revokes the server-side session. The signature is still verified.
 */
export async function decodeExpiredAdminToken(token: string): Promise<string | null> {
  try {
    const exp = decodeJwt(token).exp;
    const key = new TextEncoder().encode(getEnv("auth").JWT_ACCESS_SECRET);
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
      issuer: "mm-collections",
      audience: "admin",
      // Verify "as of" just before expiry so an expired-but-genuine token passes.
      currentDate: exp ? new Date((exp - 1) * 1000) : undefined,
    });
    return typeof payload.sid === "string" ? payload.sid : null;
  } catch {
    return null;
  }
}
