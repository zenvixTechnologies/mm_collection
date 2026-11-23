import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { getEnv } from "@/server/config/env";

/** 256-bit random refresh token. Only its keyed hash is stored. */
export function generateRefreshToken() {
  return randomBytes(32).toString("base64url");
}

/**
 * HMAC-SHA256 with JWT_REFRESH_SECRET: a leaked database alone can't be used to forge or
 * look up valid tokens.
 */
export function hashRefreshToken(token: string) {
  return createHmac("sha256", getEnv("auth").JWT_REFRESH_SECRET).update(token).digest("base64url");
}
