import "server-only";
import { decodeJwt, jwtVerify } from "jose";
import { getEnv } from "@/server/config/env";
import type { Audience } from "./jwt";

/**
 * Session id from a correctly signed token for `aud`, even if it has expired — used only so that
 * logging out always revokes the server-side session. The signature and audience are still
 * verified, so an admin token can't end a customer session or vice versa.
 */
export async function decodeExpiredToken(token: string, aud: Audience): Promise<string | null> {
  try {
    const exp = decodeJwt(token).exp;
    const key = new TextEncoder().encode(getEnv("auth").JWT_ACCESS_SECRET);
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
      issuer: "mm-collections",
      audience: aud,
      // Verify "as of" just before expiry so an expired-but-genuine token passes.
      currentDate: exp ? new Date((exp - 1) * 1000) : undefined,
    });
    return typeof payload.sid === "string" ? payload.sid : null;
  } catch {
    return null;
  }
}

export const decodeExpiredAdminToken = (token: string) => decodeExpiredToken(token, "admin");
