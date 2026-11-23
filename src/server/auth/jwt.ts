// Narrow imports keep jose's encryption (JWE) code — unused here — out of the edge bundle.
import { JWTExpired } from "jose/errors";
import { SignJWT } from "jose/jwt/sign";
import { jwtVerify } from "jose/jwt/verify";

/**
 * Access-token signing and verification. Edge-safe (used by middleware too), so it reads the
 * secret straight from the environment and imports nothing server-only.
 */

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const ISSUER = "mm-collections";

export type Audience = "admin" | "customer";

export interface AccessClaims {
  /** Admin or user ID. */
  sub: string;
  /** Session ID — lets the server revoke a token before it expires. */
  sid: string;
  aud: Audience;
}

function secretKey() {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret || secret.length < 32) throw new Error("JWT_ACCESS_SECRET is not configured");
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(claims: AccessClaims, ttlSeconds = ACCESS_TOKEN_TTL_SECONDS) {
  return new SignJWT({ sid: claims.sid })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.sub)
    .setAudience(claims.aud)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secretKey());
}

export type VerifyResult = { ok: true; claims: AccessClaims } | { ok: false; reason: "expired" | "invalid" };

/** Verifies signature, algorithm, issuer, audience and expiry. Never throws. */
export async function verifyAccessToken(token: string | undefined, aud: Audience): Promise<VerifyResult> {
  if (!token) return { ok: false, reason: "invalid" };
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"], issuer: ISSUER, audience: aud });
    if (typeof payload.sub !== "string" || typeof payload.sid !== "string") return { ok: false, reason: "invalid" };
    return { ok: true, claims: { sub: payload.sub, sid: payload.sid, aud } };
  } catch (err) {
    return { ok: false, reason: err instanceof JWTExpired ? "expired" : "invalid" };
  }
}
