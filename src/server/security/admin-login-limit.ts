import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { getEnv, isConfigured, type Env } from "@/server/config/env";
import { AppError, tooManyRequests } from "@/server/http/errors";
import { audit } from "@/server/services/audit.service";
import { logger } from "@/server/utils/logger";

/**
 * Brute-force protection for admin sign-in. Separate from the general rate limiter because it must
 * be stricter: it never trusts a client-chosen IP, and it refuses sign-in when it can't count.
 *
 * Every attempt is counted BEFORE the password is checked, so parallel requests can't slip past.
 * Three limits apply, in order, each over a fixed window that starts at its first attempt (so a
 * block always ends on time, however often it is retried):
 *
 *   1. per IP, across all usernames and emails;
 *   2. per (typed identifier + IP): only that IP is held back;
 *   3. per typed identifier across all IPs — applied only to IPs that haven't signed in to it
 *      successfully in the last 30 days, so an attack can't lock an admin out of their usual network.
 *
 * Limits are keyed on what was typed, whether or not such an account exists, so they reveal nothing.
 * Nothing is ever locked in the database. A successful sign-in clears (2), and takes back its own
 * attempt from (1) and (3) without erasing anyone else's failures.
 */

type Config = Env<"adminLogin">;
type Scope = "ip" | "account-ip" | "account";

const KNOWN_IP_SECONDS = 30 * 24 * 60 * 60;
const REDIS_TIMEOUT_MS = 2_000;
const RETRY_WHEN_UNAVAILABLE_SECONDS = 30;

/* ---------- Client IP ---------- */

/** A valid address in the form it is limited by: IPv4 as is, IPv6 by /64 (one customer's block). */
function ipBucket(address: string): string | null {
  const kind = isIP(address);
  if (kind === 4) return address;
  if (kind !== 6) return null;
  let text = address.toLowerCase().split("%")[0];
  const v4 = text.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    text = `${text.slice(0, -v4[0].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = (tail === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right]).map((g) => parseInt(g, 16));
  // IPv4-mapped (::ffff:a.b.c.d) is the same client as the IPv4 address.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join(".");
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
}

/**
 * The client's IP, only from a header the hosting platform sets itself:
 * - on Vercel (VERCEL=1), `x-vercel-forwarded-for`, then `x-real-ip` / `x-forwarded-for` — Vercel
 *   overwrites these, so a client can't choose them;
 * - elsewhere, only the header named by TRUSTED_CLIENT_IP_HEADER (set it only for a proxy that
 *   sets or appends that header), taking the last value, the one the proxy itself added;
 * - otherwise none: all such requests share one bucket.
 */
export function trustedClientIp(req: Request, trustedHeader?: string): { address: string; bucket: string } | null {
  const onVercel = process.env.VERCEL === "1";
  const headers = onVercel ? ["x-vercel-forwarded-for", "x-real-ip", "x-forwarded-for"] : trustedHeader ? [trustedHeader] : [];
  for (const name of headers) {
    const values = req.headers.get(name)?.split(",");
    const address = (onVercel ? values?.[0] : values?.at(-1))?.trim() ?? "";
    const bucket = ipBucket(address);
    if (bucket) return { address, bucket };
  }
  return null;
}

/* ---------- Counter stores ---------- */

interface Store {
  /** Adds one attempt; returns the total in the current window and the seconds it has left. */
  count(key: string, windowSeconds: number): Promise<{ count: number; ttl: number }>;
  refund(key: string, windowSeconds: number): Promise<void>;
  clear(keys: string[]): Promise<void>;
  mark(key: string, ttlSeconds: number): Promise<void>;
  has(key: string): Promise<boolean>;
}

/**
 * Upstash REST. /multi-exec runs the commands atomically (unlike /pipeline), and every counter is
 * created with its expiry first, so none can be left without one. Anything unexpected throws.
 * Errors carry only a short reason — never the URL, token or Upstash's own message.
 */
function upstashStore(url: string, token: string): Store {
  async function exec(commands: string[][]): Promise<unknown[]> {
    let res: Response;
    try {
      res = await fetch(`${url.replace(/\/$/, "")}/multi-exec`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(commands),
        cache: "no-store",
        signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
      });
    } catch {
      throw new LimiterError("unreachable");
    }
    if (!res.ok) throw new LimiterError(`http_${res.status}`);
    const body = (await res.json().catch(() => null)) as unknown;
    if (!Array.isArray(body) || body.length !== commands.length || !body.every((r) => r && typeof r === "object" && "result" in r && !("error" in r))) {
      throw new LimiterError("bad_response");
    }
    return body.map((r) => (r as { result: unknown }).result);
  }
  const integer = (v: unknown) => {
    if (!Number.isSafeInteger(v)) throw new LimiterError("bad_response");
    return v as number;
  };
  const create = (key: string, windowSeconds: number) => ["SET", key, "0", "EX", String(windowSeconds), "NX"];
  return {
    async count(key, windowSeconds) {
      const [, count, ttl] = await exec([create(key, windowSeconds), ["INCR", key], ["TTL", key]]);
      let left = integer(ttl);
      if (left < 0) {
        await exec([["EXPIRE", key, String(windowSeconds)]]);
        left = windowSeconds;
      }
      return { count: integer(count), ttl: left };
    },
    async refund(key, windowSeconds) {
      await exec([create(key, windowSeconds), ["DECR", key]]);
    },
    async clear(keys) {
      await exec([["DEL", ...keys]]);
    },
    async mark(key, ttlSeconds) {
      await exec([["SET", key, "1", "EX", String(ttlSeconds)]]);
    },
    async has(key) {
      return integer((await exec([["EXISTS", key]]))[0]) === 1;
    },
  };
}

/** One process only — for development. Never used on Vercel in production. */
const memory = new Map<string, { value: number; expiresAt: number }>();

function live(key: string) {
  const entry = memory.get(key);
  if (entry && entry.expiresAt <= Date.now()) memory.delete(key);
  return memory.get(key);
}

function windowEntry(key: string, windowSeconds: number) {
  if (memory.size > 10_000) for (const k of [...memory.keys()]) live(k);
  let entry = live(key);
  if (!entry) memory.set(key, (entry = { value: 0, expiresAt: Date.now() + windowSeconds * 1000 }));
  return entry;
}

const memoryStore: Store = {
  async count(key, windowSeconds) {
    const entry = windowEntry(key, windowSeconds);
    entry.value += 1;
    return { count: entry.value, ttl: Math.ceil((entry.expiresAt - Date.now()) / 1000) };
  },
  async refund(key, windowSeconds) {
    windowEntry(key, windowSeconds).value -= 1;
  },
  async clear(keys) {
    for (const key of keys) memory.delete(key);
  },
  async mark(key, ttlSeconds) {
    memory.set(key, { value: 1, expiresAt: Date.now() + ttlSeconds * 1000 });
  },
  async has(key) {
    return !!live(key);
  },
};

/** Tests only. */
export function resetAdminLoginLimits() {
  memory.clear();
}

class LimiterError extends Error {}

/**
 * Upstash whenever it is configured. Without it: memory in development; in production, sign-in is
 * refused. A local `npm run start` may opt into memory, which is ignored on Vercel.
 */
function chooseStore(config: Config): Store {
  if (isConfigured("upstash")) {
    const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = getEnv("upstash");
    if (!url.startsWith("https://")) throw new LimiterError("url_not_https");
    return upstashStore(url, token);
  }
  if (process.env.NODE_ENV !== "production") return memoryStore;
  if (config.ADMIN_LOGIN_ALLOW_MEMORY_RATE_LIMIT === "true" && process.env.VERCEL !== "1") return memoryStore;
  throw new LimiterError("not_configured");
}

/** Fail closed: if attempts can't be counted, nobody gets to try a password. */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof AppError) throw err;
    const reason = err instanceof LimiterError ? err.message : "error";
    logger.error("admin_login.limiter_unavailable", {
      reason,
      ...(reason === "not_configured" ? { hint: "Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN. Admin sign-in stays refused in production without them." } : {}),
    });
    throw new AppError(503, "SERVICE_UNAVAILABLE", "Sign-in is temporarily unavailable. Please try again shortly.", {
      headers: { "Retry-After": String(RETRY_WHEN_UNAVAILABLE_SECONDS) },
    });
  }
}

/* ---------- One sign-in attempt ---------- */

/** Identifiers and addresses are stored only as keyed hashes. */
function keyFor(kind: "ip" | "pair" | "account" | "known", ...parts: string[]) {
  const digest = createHmac("sha256", `mm:admin-login-limit:v1:${getEnv("auth").JWT_ACCESS_SECRET}`).update(JSON.stringify([kind, ...parts])).digest("base64url");
  return `admin-login:${kind}:${digest}`;
}

/**
 * Starts an attempt and applies the per-IP limit (before the body is even read). Then call
 * `forAccount` before checking the password, and `succeeded` only after it was accepted.
 * Both throw 429 when limited and 503 when attempts can't be counted.
 */
export async function startAdminLoginAttempt(req: Request, { userAgent }: { userAgent: string }) {
  const config = await guarded(async () => getEnv("adminLogin"));
  const client = trustedClientIp(req, config.TRUSTED_CLIENT_IP_HEADER);
  if (!client && process.env.NODE_ENV === "production") logger.warn("admin_login.client_ip_unknown", { hint: "No trusted client IP header; these requests share one limit." });
  const bucket = client?.bucket ?? "unknown";
  const ip = client?.address ?? "";
  const window = config.ADMIN_LOGIN_WINDOW_SECONDS;
  const store = await guarded(async () => chooseStore(config));

  async function enforce(scope: Scope, key: string, limit: number, identifier?: string, exempt?: () => Promise<boolean>) {
    const { count, ttl } = await guarded(() => store.count(key, window));
    if (count <= limit) return;
    if (count === limit + 1) {
      // Logged once, when the limit is first passed, so an attack can't flood the logs.
      logger.warn("admin_login.throttled", { limit: scope });
      await audit({ name: "unknown", email: identifier ?? null, ip, userAgent }, "admin.login_throttled", { type: "admin", label: identifier }, { limit: scope });
    }
    if (exempt && (await guarded(exempt))) return;
    // The same message whichever limit applied: it says nothing about the account.
    throw tooManyRequests(ttl, `Too many sign-in attempts. Please wait up to ${Math.ceil(window / 60)} minutes and try again.`);
  }

  await enforce("ip", keyFor("ip", bucket), config.ADMIN_LOGIN_IP_LIMIT);
  let typed = "";

  return {
    /** The trusted client address for the audit log ("" when there is none). */
    ip,
    async forAccount(identifier: string) {
      typed = identifier;
      await enforce("account-ip", keyFor("pair", identifier, bucket), config.ADMIN_LOGIN_ACCOUNT_IP_LIMIT, identifier);
      await enforce("account", keyFor("account", identifier), config.ADMIN_LOGIN_ACCOUNT_LIMIT, identifier, async () =>
        // An address we can't identify is never "familiar".
        client ? store.has(keyFor("known", identifier, bucket)) : false,
      );
    },
    /** `aliases`: the signed-in admin's username and email. Never fails a correct sign-in. */
    async succeeded(aliases: (string | null)[]) {
      const names = [...new Set([typed, ...aliases.flatMap((a) => (a ? [a.toLowerCase()] : []))])];
      try {
        await store.clear(names.map((name) => keyFor("pair", name, bucket)));
        await store.refund(keyFor("ip", bucket), window);
        await store.refund(keyFor("account", typed), window);
        if (client) for (const name of names) await store.mark(keyFor("known", name, bucket), KNOWN_IP_SECONDS);
      } catch (err) {
        logger.warn("admin_login.limiter_reset_failed", { reason: err instanceof LimiterError ? err.message : "error" });
      }
    },
  };
}
