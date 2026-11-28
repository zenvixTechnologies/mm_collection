import "server-only";
import { getEnv, isConfigured } from "@/server/config/env";
import { tooManyRequests } from "@/server/http/errors";
import { clientIp } from "@/server/http/request-info";
import { resetAdminLoginLimits } from "@/server/security/admin-login-limit";
import { logger, serializeError } from "@/server/utils/logger";

/**
 * Fixed-window rate limiting.
 *
 * Uses Upstash Redis (REST) when UPSTASH_REDIS_REST_URL/TOKEN are set, so limits hold across all
 * serverless instances. Until then it falls back to a per-instance in-memory counter — fine for
 * development, but weaker in production (logged once as a warning).
 */

export interface LimitResult {
  ok: boolean;
  remaining: number;
  retryAfter: number;
}

const memory = new Map<string, { count: number; resetAt: number }>();
let warned = false;

function memoryHit(key: string, limit: number, windowSeconds: number): LimitResult {
  const now = Date.now();
  if (memory.size > 10_000) for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
  const entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { ok: true, remaining: limit - 1, retryAfter: 0 };
  }
  entry.count++;
  return { ok: entry.count <= limit, remaining: Math.max(0, limit - entry.count), retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
}

async function upstashHit(key: string, limit: number, windowSeconds: number): Promise<LimitResult> {
  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = getEnv("upstash");
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const redisKey = `rl:${key}:${window}`;
  const res = await fetch(`${UPSTASH_REDIS_REST_URL.replace(/\/$/, "")}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify([
      ["INCR", redisKey],
      ["EXPIRE", redisKey, String(windowSeconds), "NX"],
    ]),
    cache: "no-store",
    signal: AbortSignal.timeout(2_000),
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}`);
  const [incr] = (await res.json()) as [{ result: number }];
  const count = incr.result;
  const retryAfter = (window + 1) * windowSeconds - Math.floor(Date.now() / 1000);
  return { ok: count <= limit, remaining: Math.max(0, limit - count), retryAfter: Math.max(1, retryAfter) };
}

export async function hit(key: string, limit: number, windowSeconds: number): Promise<LimitResult> {
  if (isConfigured("upstash")) {
    try {
      return await upstashHit(key, limit, windowSeconds);
    } catch (err) {
      // Don't lock everyone out because Redis is briefly unreachable.
      logger.warn("ratelimit.upstash_failed", { error: serializeError(err) });
    }
  } else if (!warned && process.env.NODE_ENV === "production") {
    warned = true;
    logger.warn("ratelimit.memory_fallback", { hint: "Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN for distributed rate limiting." });
  }
  return memoryHit(key, limit, windowSeconds);
}

/** Throws 429 (with Retry-After) once `limit` requests per `windowSeconds` is exceeded. */
export async function enforceRateLimit(
  req: Request,
  name: string,
  limit: number,
  windowSeconds: number,
  subject?: string,
  message?: string,
) {
  const who = subject ?? (clientIp(req) || "unknown");
  const result = await hit(`${name}:${who}`, limit, windowSeconds);
  if (!result.ok) throw tooManyRequests(result.retryAfter, message);
}

/** Tests only. */
export function resetRateLimits() {
  memory.clear();
  resetAdminLoginLimits();
}
