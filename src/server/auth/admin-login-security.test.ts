import bcrypt from "bcryptjs";
import { MongoMemoryServer } from "mongodb-memory-server";
import { NextRequest, type NextResponse } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login } from "@/app/api/v1/admin/auth/login/route";
import { POST as logout } from "@/app/api/v1/admin/auth/logout/route";
import { GET as me } from "@/app/api/v1/admin/auth/me/route";
import { POST as refresh } from "@/app/api/v1/admin/auth/refresh/route";
import { POST as customerLogin } from "@/app/api/v1/auth/login/route";
import { resetEnvCache } from "@/server/config/env";
import { connectToDatabase, disconnectFromDatabase } from "@/server/db/connect";
import { Admin, AuditLog, Role, Session, User } from "@/server/models";
import { resetRateLimits } from "@/server/security/rate-limit";
import { ADMIN_ACCESS_COOKIE, ADMIN_REFRESH_COOKIE } from "./cookies";
import * as password from "./password";
import { DEFAULT_ROLE_PERMISSIONS } from "./permissions";

/**
 * Admin sign-in protection: layered rate limits, no account discovery, no easy lock-out, and a
 * limiter that fails closed in production. Isolated in-memory MongoDB and a fake Upstash.
 */

const ORIGIN = "http://localhost:3000";
const PASSWORD = "Correct-horse-42";
const WRONG = "Wrong-password-1";
const OWNER = "owner@test.in";
const IP_LIMIT = 30;
const PAIR_LIMIT = 8;
const ACCOUNT_LIMIT = 40;
const WINDOW = 900;
const UPSTASH_URL = "https://fake-upstash.example";
const UPSTASH_TOKEN = "upstash-secret-token-do-not-log";
const ctx = { params: Promise.resolve({}) };
vi.setConfig({ testTimeout: 30_000 });
/**
 * These tests are about limiting, and make hundreds of password checks, so they use cheap hashes.
 * The real hashing cost is covered by admin-auth.test.ts.
 */
const TEST_BCRYPT_COST = 4;
let mongo: MongoMemoryServer;

/* ---------- Clock ---------- */

let offset = 0;
const realNow = Date.now.bind(Date);
const advance = (seconds: number) => (offset += seconds * 1000);

/* ---------- Fake Upstash (REST /multi-exec), shared by every "instance" ---------- */

const redis = {
  data: new Map<string, { value: number; expiresAt: number }>(),
  requests: [] as { url: string; commands: string[][] }[],
  mode: "ok" as "ok" | "down" | "http500" | "unauthorized" | "command-error" | "garbage" | "discarded" | "short",
  live(key: string) {
    const e = this.data.get(key);
    if (e && e.expiresAt <= Date.now()) this.data.delete(key);
    return this.data.get(key);
  },
  run([cmd, key, ...args]: string[]): unknown {
    const e = this.live(key);
    switch (cmd) {
      case "SET": {
        if (args.includes("NX") && e) return null;
        this.data.set(key, { value: Number(args[0]), expiresAt: Date.now() + Number(args[args.indexOf("EX") + 1]) * 1000 });
        return "OK";
      }
      case "INCR":
      case "DECR": {
        const next = e ?? { value: 0, expiresAt: Infinity };
        next.value += cmd === "INCR" ? 1 : -1;
        this.data.set(key, next);
        return next.value;
      }
      case "TTL":
        return !e ? -2 : e.expiresAt === Infinity ? -1 : Math.ceil((e.expiresAt - Date.now()) / 1000);
      case "EXPIRE":
        if (e) e.expiresAt = Date.now() + Number(args[0]) * 1000;
        return e ? 1 : 0;
      case "EXISTS":
        return e ? 1 : 0;
      case "DEL":
        return [key, ...args].filter((k) => this.data.delete(k)).length;
      default:
        throw new Error(`unsupported ${cmd}`);
    }
  },
  handle(url: string, init: RequestInit): Response {
    const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s });
    if (this.mode === "down") throw new TypeError(`fetch failed: ${UPSTASH_TOKEN} ${url}`);
    if (this.mode === "http500") return json({ error: "boom" }, 500);
    if (this.mode === "unauthorized" || new Headers(init.headers).get("authorization") !== `Bearer ${UPSTASH_TOKEN}`) return json({ error: `WRONGPASS ${UPSTASH_TOKEN}` }, 401);
    const commands = JSON.parse(String(init.body)) as string[][];
    this.requests.push({ url, commands });
    if (this.mode === "garbage") return new Response("<html>", { status: 200 });
    if (this.mode === "discarded") return json({ error: "ERR transaction discarded" });
    if (this.mode === "command-error") return json(commands.map(() => ({ error: "ERR max requests limit exceeded" })));
    if (this.mode === "short") return json([]);
    return json(commands.map((c) => ({ result: this.run(c) })));
  },
};

/* ---------- Harness ---------- */

type Jar = Record<string, string>;
type Body = { success: boolean; message: string; data?: { admin?: { email: string; role: { key: string }; permissions: string[] } }; error?: { code: string; requestId?: string } };

function request(path: string, init: { method?: string; body?: unknown; raw?: string; jar?: Jar; headers?: Record<string, string>; origin?: string } = {}) {
  const headers: Record<string, string> = { "user-agent": "vitest", origin: init.origin ?? ORIGIN, ...init.headers };
  if (init.body !== undefined || init.raw !== undefined) headers["content-type"] = "application/json";
  if (init.jar) headers.cookie = Object.entries(init.jar).map(([k, v]) => `${k}=${v}`).join("; ");
  return new NextRequest(`${ORIGIN}${path}`, { method: init.method ?? "POST", headers, body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)) });
}

/** As Vercel delivers a request: the platform sets these headers itself. */
const from = (ip: string): Record<string, string> => ({ "x-vercel-forwarded-for": ip, "x-real-ip": ip, "x-forwarded-for": ip });

async function attempt(identifier: string, pass = WRONG, ip = "203.0.113.1", headers?: Record<string, string>) {
  const res = (await login(request("/api/v1/admin/auth/login", { body: { identifier, password: pass }, headers: headers ?? from(ip) }), ctx)) as NextResponse;
  const body = (await res.clone().json()) as Body;
  return { res, body, status: res.status, retryAfter: Number(res.headers.get("retry-after")), jar: Object.fromEntries(res.cookies.getAll().filter((c) => c.value).map((c) => [c.name, c.value])) as Jar };
}
const times = async (n: number, f: (i: number) => ReturnType<typeof attempt>) => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((await f(i)).status);
  return out;
};
const all = (status: number, n: number) => Array(n).fill(status);

async function makeAdmin(email: string, roleKey: "owner" | "manager", extra: Record<string, unknown> = {}) {
  const role = await Role.findOne({ key: roleKey });
  return Admin.create({ name: email.split("@")[0], email, passwordHash: hash, role: role!._id, ...extra });
}
let hash: string;

function useUpstash() {
  vi.stubEnv("UPSTASH_REDIS_REST_URL", UPSTASH_URL);
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", UPSTASH_TOKEN);
  resetEnvCache();
}
function production() {
  vi.stubEnv("NODE_ENV", "production");
  resetEnvCache();
}

const logs: string[] = [];

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  hash = await bcrypt.hash(PASSWORD, TEST_BCRYPT_COST);
}, 180_000);

beforeEach(async () => {
  vi.restoreAllMocks();
  // The check made for unknown accounts, at the same cheap cost.
  vi.spyOn(password, "burnPasswordCheck").mockImplementation(async (plain) => void (await bcrypt.compare(plain, hash)));
  vi.unstubAllEnvs();
  vi.stubEnv("MONGODB_URI", mongo.getUri());
  vi.stubEnv("MONGODB_DB_NAME", "mm-login-security-test");
  vi.stubEnv("JWT_ACCESS_SECRET", "a".repeat(48));
  vi.stubEnv("JWT_REFRESH_SECRET", "r".repeat(48));
  vi.stubEnv("VERCEL", "1");
  for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "ADMIN_LOGIN_ALLOW_MEMORY_RATE_LIMIT", "TRUSTED_CLIENT_IP_HEADER"]) vi.stubEnv(k, "");
  resetEnvCache();
  offset = 0;
  vi.spyOn(Date, "now").mockImplementation(() => realNow() + offset);
  redis.data.clear();
  redis.requests = [];
  redis.mode = "ok";
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (!String(input).startsWith(UPSTASH_URL)) throw new Error(`Unexpected network call: ${String(input)}`);
    return redis.handle(String(input), init);
  }));
  logs.length = 0;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, level).mockImplementation((...a) => void logs.push(a.map(String).join(" ")));
  await connectToDatabase();
  await Promise.all([Admin.deleteMany({}), Session.deleteMany({}), AuditLog.deleteMany({}), Role.deleteMany({})]);
  for (const [key, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) await Role.create({ key, name: key, permissions: [...permissions], isSystem: true });
  await makeAdmin(OWNER, "owner", { username: "bossman" });
  await makeAdmin("manager@test.in", "manager");
  resetRateLimits();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await disconnectFromDatabase();
  await mongo?.stop();
  resetEnvCache();
});

/* Every limit rule is checked against both stores: in-memory (development) and Upstash. */
describe.each(["memory", "upstash"] as const)("rate limits (%s store)", (store) => {
  beforeEach(() => {
    if (store === "upstash") {
      useUpstash();
      production();
    }
  });

  it("limits one IP across different usernames and email addresses", async () => {
    const statuses = await times(IP_LIMIT + 5, (i) => attempt(i % 2 ? `ghost${i}@test.in` : `ghost_user${i}`));
    expect(statuses).toEqual([...all(401, IP_LIMIT), ...all(429, 5)]);
    // Changing to a real account and using its correct password doesn't get round it either.
    expect((await attempt(OWNER, PASSWORD)).status).toBe(429);
    expect((await attempt("bossman", PASSWORD)).status).toBe(429);
  });

  it("limits one account from one IP, without affecting that account from another IP", async () => {
    expect(await times(PAIR_LIMIT + 3, () => attempt(OWNER))).toEqual([...all(401, PAIR_LIMIT), ...all(429, 3)]);
    expect((await attempt(OWNER, PASSWORD)).status).toBe(429); // temporary, for this IP only
    expect((await attempt(OWNER, PASSWORD, "198.51.100.9")).status).toBe(200); // the real admin, elsewhere
    expect((await attempt("manager@test.in", PASSWORD)).status).toBe(200); // same IP, another account
  });

  it("treats the identifier case- and space-insensitively", async () => {
    await times(PAIR_LIMIT, (i) => attempt(i % 2 ? "  OWNER@Test.IN " : OWNER));
    expect((await attempt("Owner@test.in")).status).toBe(429);
  });

  it("treats different IPs independently", async () => {
    await times(IP_LIMIT, (i) => attempt(`ghost${i}@test.in`, WRONG, "203.0.113.1"));
    expect((await attempt("other@test.in", WRONG, "203.0.113.1")).status).toBe(429);
    expect((await attempt("other@test.in", WRONG, "203.0.113.2")).status).toBe(401);
  });

  it("limits one account attacked from many IPs, but never the IP the admin signs in from", async () => {
    expect((await attempt(OWNER, PASSWORD, "198.51.100.7")).status).toBe(200); // the admin's usual network
    const statuses = await times(ACCOUNT_LIMIT + 6, (i) => attempt(OWNER, WRONG, `192.0.2.${i}`));
    expect(statuses).toEqual([...all(401, ACCOUNT_LIMIT), ...all(429, 6)]);
    expect((await attempt(OWNER, PASSWORD, "192.0.2.200")).status).toBe(429); // unfamiliar IP: temporarily limited
    expect((await attempt(OWNER, PASSWORD, "198.51.100.7")).status).toBe(200); // familiar IP: still works
    expect((await attempt(OWNER, WRONG, "198.51.100.7")).status).toBe(401);
    expect((await attempt("manager@test.in", PASSWORD, "192.0.2.201")).status).toBe(200);
  });

  it("a single IP can't push an account into the all-IP limit", async () => {
    await times(IP_LIMIT + 10, () => attempt(OWNER, WRONG, "203.0.113.66"));
    expect((await attempt(OWNER, PASSWORD, "198.51.100.55")).status).toBe(200);
    // Even several attacking IPs short of the threshold leave a new IP able to sign in.
    for (const ip of ["203.0.113.67", "203.0.113.68", "203.0.113.69"]) await times(IP_LIMIT, () => attempt(OWNER, WRONG, ip));
    expect((await attempt(OWNER, PASSWORD, "198.51.100.56")).status).toBe(200);
  });

  it("a familiar IP is still held to the per-IP-and-account limit", async () => {
    await attempt(OWNER, PASSWORD);
    expect(await times(PAIR_LIMIT + 2, () => attempt(OWNER))).toEqual([...all(401, PAIR_LIMIT), ...all(429, 2)]);
  });

  it("sends Retry-After that counts down, and lifts the block on time without extending it", async () => {
    await times(PAIR_LIMIT, () => attempt(OWNER));
    const first = await attempt(OWNER);
    expect(first.status).toBe(429);
    expect(first.body.error!.code).toBe("RATE_LIMITED");
    expect(first.retryAfter).toBeGreaterThan(WINDOW - 30);
    expect(first.retryAfter).toBeLessThanOrEqual(WINDOW);
    advance(600);
    const later = await attempt(OWNER, PASSWORD);
    expect(later.status).toBe(429);
    expect(later.retryAfter).toBeLessThanOrEqual(WINDOW - 600);
    await times(5, () => attempt(OWNER)); // hammering while blocked doesn't extend it
    advance(later.retryAfter + 1);
    expect((await attempt(OWNER, PASSWORD)).status).toBe(200);
  });

  it("a successful sign-in clears this IP's failures for the account", async () => {
    for (let round = 0; round < 3; round++) {
      expect(await times(PAIR_LIMIT - 1, () => attempt(OWNER))).toEqual(all(401, PAIR_LIMIT - 1));
      expect((await attempt(OWNER, PASSWORD)).status).toBe(200);
    }
    expect((await Admin.findOne({ email: OWNER }).lean())!.failedLoginCount).toBe(0);
  });

  it("successful sign-ins don't use up the IP's allowance, and don't reset others' failures", async () => {
    expect(await times(IP_LIMIT + 5, () => attempt(OWNER, PASSWORD))).toEqual(all(200, IP_LIMIT + 5));
    await times(IP_LIMIT - 1, (i) => attempt(`ghost${i}@test.in`));
    expect((await attempt("manager@test.in", PASSWORD)).status).toBe(200); // one's own login…
    expect((await attempt("ghostx@test.in")).status).toBe(401);
    expect((await attempt("ghosty@test.in")).status).toBe(429); // …didn't hand back the failures
  });

  it("concurrent attempts can't exceed the account limit or reach the password check", async () => {
    const verify = vi.spyOn(password, "verifyPassword");
    const results = await Promise.all(Array.from({ length: 40 }, () => attempt(OWNER)));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(PAIR_LIMIT);
    expect(statuses.filter((s) => s === 429)).toHaveLength(40 - PAIR_LIMIT);
    expect(verify).toHaveBeenCalledTimes(PAIR_LIMIT);
  });

  it("concurrent attempts with different names can't exceed the IP limit", async () => {
    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => attempt(`ghost${i}@test.in`)));
    expect(results.filter((r) => r.status === 401)).toHaveLength(IP_LIMIT);
    expect(results.filter((r) => r.status === 429)).toHaveLength(60 - IP_LIMIT);
  });

  it("concurrent attempts from many IPs can't exceed the account limit", async () => {
    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => attempt(OWNER, WRONG, `192.0.2.${i}`)));
    expect(results.filter((r) => r.status === 401)).toHaveLength(ACCOUNT_LIMIT);
  });

  it("counts malformed requests against the IP", async () => {
    for (let i = 0; i < IP_LIMIT; i++) {
      const r = await login(request("/api/v1/admin/auth/login", { raw: "{not json", headers: from("203.0.113.1") }), ctx);
      expect(r.status).toBe(400);
    }
    expect((await attempt(OWNER, PASSWORD)).status).toBe(429);
  });

  it("cross-site requests are refused without using anyone's allowance", async () => {
    for (let i = 0; i < IP_LIMIT + 5; i++) {
      const r = await login(request("/api/v1/admin/auth/login", { body: { identifier: OWNER, password: WRONG }, headers: from("203.0.113.1"), origin: "https://evil.example" }), ctx);
      expect(r.status).toBe(403);
    }
    expect((await attempt(OWNER, PASSWORD)).status).toBe(200);
  });
});

/* ---------- Nothing reveals whether an account exists ---------- */

describe("no account discovery", () => {
  const publicView = (r: Awaited<ReturnType<typeof attempt>>) => ({ status: r.status, retryAfter: r.res.headers.get("retry-after"), body: { ...r.body, error: { ...r.body.error, requestId: "x" } }, cookies: r.res.cookies.getAll().length });

  it("unknown account, wrong password and disabled account look identical", async () => {
    await makeAdmin("disabled@test.in", "manager", { status: "disabled" });
    const unknown = await attempt("ghost@test.in", PASSWORD, "203.0.113.10");
    const wrong = await attempt(OWNER, WRONG, "203.0.113.11");
    const disabled = await attempt("disabled@test.in", PASSWORD, "203.0.113.12");
    expect(unknown.status).toBe(401);
    expect(publicView(wrong)).toEqual(publicView(unknown));
    expect(publicView(disabled)).toEqual(publicView(unknown));
  });

  it("the limited sequence is identical for real and unknown accounts", async () => {
    const run = async (name: string, ip: string) => {
      const seen = [];
      for (let i = 0; i < PAIR_LIMIT + 3; i++) seen.push(publicView(await attempt(name, WRONG, ip)));
      return seen;
    };
    const real = await run(OWNER, "203.0.113.20");
    resetRateLimits();
    const fake = await run("nobody@test.in", "203.0.113.21");
    expect(real.map((r) => r.status)).toEqual([...all(401, PAIR_LIMIT), ...all(429, 3)]);
    const apartFromTiming = (list: typeof real) => list.map((r) => ({ ...r, retryAfter: r.retryAfter === null ? null : "set" }));
    expect(apartFromTiming(fake)).toEqual(apartFromTiming(real));
    fake.forEach((r, i) => expect(Math.abs(Number(r.retryAfter) - Number(real[i].retryAfter))).toBeLessThan(30));
  });

  it("never returns 423 or lock-out details, even for a stored lock left by the old code", async () => {
    await Admin.updateOne({ email: OWNER }, { $set: { lockedUntil: new Date(Date.now() + 3_600_000), failedLoginCount: 4 } });
    const wrong = await attempt(OWNER, WRONG);
    expect(wrong.status).toBe(401);
    expect(JSON.stringify(wrong.body)).not.toMatch(/lock|minute|ACCOUNT_LOCKED/i);
    expect((await attempt(OWNER, PASSWORD)).status).toBe(200); // the right password isn't held hostage
  });

  it("no number of failures stores a lock on the account", async () => {
    await times(60, (i) => attempt(OWNER, WRONG, `192.0.2.${i}`));
    expect((await Admin.findOne({ email: OWNER }).lean())!.lockedUntil ?? null).toBeNull();
  });

  it("429 responses don't say which limit applied or anything about the account", async () => {
    const messages = new Set<string>();
    await times(PAIR_LIMIT, () => attempt(OWNER, WRONG, "203.0.113.30"));
    messages.add((await attempt(OWNER, WRONG, "203.0.113.30")).body.message);
    await times(IP_LIMIT, (i) => attempt(`g${i}@test.in`, WRONG, "203.0.113.31"));
    messages.add((await attempt("g99@test.in", WRONG, "203.0.113.31")).body.message);
    await times(ACCOUNT_LIMIT, (i) => attempt("manager@test.in", WRONG, `192.0.2.${i}`));
    messages.add((await attempt("manager@test.in", WRONG, "192.0.2.222")).body.message);
    expect(messages.size).toBe(1);
    expect([...messages][0]).not.toMatch(/account|password|ip address|exist/i);
  });

  it("records security events on the server only, once per block", async () => {
    await times(PAIR_LIMIT + 6, () => attempt(OWNER));
    expect(await AuditLog.countDocuments({ action: "admin.login_failed" })).toBe(PAIR_LIMIT);
    const throttled = await AuditLog.find({ action: "admin.login_throttled" }).lean();
    expect(throttled).toHaveLength(1);
    expect(throttled[0]).toMatchObject({ entity: { type: "admin", label: OWNER }, changes: { limit: "account-ip" } });
    expect(throttled[0].ip).toBe("203.0.113.1");
    expect(JSON.stringify(await AuditLog.find().lean())).not.toContain(WRONG);
  });
});

/* ---------- Client IP ---------- */

describe("client IP", () => {
  const exhaust = (headers: (i: number) => Record<string, string>) => times(IP_LIMIT + 3, (i) => attempt(`ghost${i}@test.in`, WRONG, "", headers(i)));

  it("on Vercel uses the platform's header, so a rotating X-Forwarded-For changes nothing", async () => {
    const statuses = await exhaust((i) => ({ "x-vercel-forwarded-for": "203.0.113.5", "x-forwarded-for": `10.0.${i}.1, 203.0.113.5`, "x-real-ip": "203.0.113.5" }));
    expect(statuses).toEqual([...all(401, IP_LIMIT), ...all(429, 3)]);
  });

  it("on Vercel falls back to x-real-ip, then X-Forwarded-For", async () => {
    expect(await exhaust((i) => ({ "x-real-ip": "203.0.113.6", "x-forwarded-for": `10.0.${i}.1` }))).toEqual([...all(401, IP_LIMIT), ...all(429, 3)]);
    expect((await attempt("a@test.in", WRONG, "", { "x-forwarded-for": "203.0.113.7" })).status).toBe(401);
    await times(IP_LIMIT - 1, (i) => attempt(`b${i}@test.in`, WRONG, "", { "x-forwarded-for": "203.0.113.7" }));
    expect((await attempt("c@test.in", WRONG, "", { "x-real-ip": "203.0.113.7" })).status).toBe(429);
  });

  it("off Vercel ignores every client-supplied IP header", async () => {
    vi.stubEnv("VERCEL", "");
    const statuses = await exhaust((i) => ({ "x-forwarded-for": `10.1.${i}.1`, "x-real-ip": `10.2.${i}.1`, "x-vercel-forwarded-for": `10.3.${i}.1`, "cf-connecting-ip": `10.4.${i}.1` }));
    expect(statuses).toEqual([...all(401, IP_LIMIT), ...all(429, 3)]);
    expect((await attempt(OWNER, WRONG, "", {})).status).toBe(429);
  });

  it("off Vercel can be told which single header its own proxy sets", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "x-real-ip");
    resetEnvCache();
    expect(await exhaust((i) => ({ "x-real-ip": "203.0.113.8", "x-forwarded-for": `10.5.${i}.1` }))).toEqual([...all(401, IP_LIMIT), ...all(429, 3)]);
    expect((await attempt("d@test.in", WRONG, "", { "x-real-ip": "203.0.113.9" })).status).toBe(401);
  });

  it("an unidentifiable client never becomes a familiar one", async () => {
    vi.stubEnv("VERCEL", "");
    expect((await attempt(OWNER, PASSWORD, "", {})).status).toBe(200);
    await times(PAIR_LIMIT, () => attempt(OWNER, WRONG, "", {}));
    expect((await attempt(OWNER, PASSWORD, "", {})).status).toBe(429);
    expect([...redis.data.keys()]).toEqual([]);
  });

  it("junk in the header can't mint new identities", async () => {
    const statuses = await exhaust((i) => ({ "x-vercel-forwarded-for": `not-an-ip-${i}` }));
    expect(statuses).toEqual([...all(401, IP_LIMIT), ...all(429, 3)]);
  });

  it("groups IPv6 addresses by /64 and treats IPv4-mapped addresses as IPv4", async () => {
    await times(IP_LIMIT, (i) => attempt(`v6${i}@test.in`, WRONG, `2001:db8:abcd:12:${i.toString(16)}::${i + 1}`));
    expect((await attempt("x@test.in", WRONG, "2001:0db8:abcd:0012:ffff:ffff:ffff:ffff")).status).toBe(429);
    expect((await attempt("x@test.in", WRONG, "2001:db8:abcd:13::1")).status).toBe(401);
    await times(IP_LIMIT, (i) => attempt(`m${i}@test.in`, WRONG, "::ffff:203.0.113.40"));
    expect((await attempt("y@test.in", WRONG, "203.0.113.40")).status).toBe(429);
  });
});

/* ---------- Upstash and production ---------- */

describe("distributed limiting and failing closed", () => {
  it("keeps counts in Upstash, so they hold across serverless instances", async () => {
    useUpstash();
    production();
    await times(PAIR_LIMIT, () => attempt(OWNER));
    resetRateLimits(); // a fresh instance has no memory of its own
    expect((await attempt(OWNER, PASSWORD)).status).toBe(429);
    expect(redis.requests.every((r) => r.url === `${UPSTASH_URL}/multi-exec`)).toBe(true);
    // Every counter has an expiry, and no name or address is stored in readable form.
    for (const [key, entry] of redis.data) {
      expect(entry.expiresAt, key).toBeLessThan(Infinity);
      expect(key).toMatch(/^admin-login:(ip|pair|account|known):[A-Za-z0-9_-]{43}$/);
    }
    expect(JSON.stringify(redis.requests)).not.toContain("owner@test.in");
    expect(JSON.stringify(redis.requests)).not.toContain("203.0.113.1");
  });

  it.each(["down", "http500", "unauthorized", "command-error", "garbage", "discarded", "short"] as const)("Upstash %s: sign-in is refused (503), even with the right password", async (mode) => {
    useUpstash();
    production();
    redis.mode = mode;
    const verify = vi.spyOn(password, "verifyPassword");
    const burn = vi.spyOn(password, "burnPasswordCheck");
    for (const [name, pass] of [[OWNER, PASSWORD], [OWNER, WRONG], ["ghost@test.in", WRONG]]) {
      const r = await attempt(name, pass);
      expect([r.status, r.body.error!.code]).toEqual([503, "SERVICE_UNAVAILABLE"]);
      expect(r.retryAfter).toBeGreaterThan(0);
      expect(r.res.cookies.getAll()).toHaveLength(0);
      expect(JSON.stringify(r.body)).not.toMatch(/upstash|redis|token/i);
    }
    expect(verify).not.toHaveBeenCalled();
    expect(burn).not.toHaveBeenCalled();
    expect(await Session.countDocuments()).toBe(0);
    expect(logs.join("\n")).toContain("admin_login.limiter_unavailable");
    expect(logs.join("\n")).not.toContain(UPSTASH_TOKEN);
  });

  it("recovers by itself once Upstash is back", async () => {
    useUpstash();
    production();
    redis.mode = "down";
    expect((await attempt(OWNER, PASSWORD)).status).toBe(503);
    redis.mode = "ok";
    expect((await attempt(OWNER, PASSWORD)).status).toBe(200);
  });

  it("fails closed for a failure that happens between the IP check and the account check", async () => {
    useUpstash();
    production();
    const real = redis.handle.bind(redis);
    let calls = 0;
    vi.spyOn(redis, "handle").mockImplementation((url, init) => {
      if (++calls === 2) throw new TypeError("fetch failed");
      return real(url, init);
    });
    const verify = vi.spyOn(password, "verifyPassword");
    expect((await attempt(OWNER, PASSWORD)).status).toBe(503);
    expect(verify).not.toHaveBeenCalled();
  });

  it("still signs in if only the clean-up after a correct password fails", async () => {
    useUpstash();
    production();
    const real = redis.handle.bind(redis);
    vi.spyOn(redis, "handle").mockImplementation((url, init) => {
      if (/"(DEL|DECR)"/.test(String(init.body))) throw new TypeError("fetch failed");
      return real(url, init);
    });
    expect((await attempt(OWNER, PASSWORD)).status).toBe(200);
  });

  it("an Upstash failure outside production also refuses, rather than switching to local counters", async () => {
    useUpstash();
    redis.mode = "down";
    expect((await attempt(OWNER, PASSWORD)).status).toBe(503);
  });

  it.each([
    ["nothing set", {}],
    ["only the URL", { UPSTASH_REDIS_REST_URL: UPSTASH_URL }],
    ["only the token", { UPSTASH_REDIS_REST_TOKEN: UPSTASH_TOKEN }],
    ["an invalid URL", { UPSTASH_REDIS_REST_URL: "not a url", UPSTASH_REDIS_REST_TOKEN: UPSTASH_TOKEN }],
  ])("production with %s refuses admin sign-in", async (_label, vars) => {
    for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v as string);
    production();
    const r = await attempt(OWNER, PASSWORD);
    expect(r.status).toBe(503);
    expect(r.res.cookies.getAll()).toHaveLength(0);
    expect(logs.join("\n")).not.toContain(UPSTASH_TOKEN);
  });

  it("the local-production escape hatch works off Vercel and is ignored on Vercel", async () => {
    vi.stubEnv("ADMIN_LOGIN_ALLOW_MEMORY_RATE_LIMIT", "true");
    production();
    expect((await attempt(OWNER, PASSWORD)).status).toBe(503); // VERCEL=1
    vi.stubEnv("VERCEL", "");
    resetEnvCache();
    expect((await attempt(OWNER, PASSWORD, "", {})).status).toBe(200);
    expect(await times(PAIR_LIMIT + 1, () => attempt(OWNER, WRONG, "", {}))).toEqual([...all(401, PAIR_LIMIT), 429]);
  });

  it("outside production, works without Upstash and still limits", async () => {
    expect((await attempt(OWNER, PASSWORD)).status).toBe(200);
    await times(PAIR_LIMIT, () => attempt(OWNER));
    expect((await attempt(OWNER)).status).toBe(429);
    expect(redis.requests).toHaveLength(0);
  });
});

/* ---------- Configuration ---------- */

describe("configurable limits", () => {
  it("reads limits from the environment", async () => {
    vi.stubEnv("ADMIN_LOGIN_IP_LIMIT", "6");
    vi.stubEnv("ADMIN_LOGIN_ACCOUNT_IP_LIMIT", "3");
    vi.stubEnv("ADMIN_LOGIN_ACCOUNT_LIMIT", "10");
    vi.stubEnv("ADMIN_LOGIN_WINDOW_SECONDS", "120");
    resetEnvCache();
    expect(await times(4, () => attempt(OWNER))).toEqual([401, 401, 401, 429]);
    expect((await attempt("z@test.in")).status).toBe(401);
    expect((await attempt("zz@test.in")).status).toBe(401);
    const blocked = await attempt("zzz@test.in");
    expect([blocked.status, blocked.retryAfter <= 120]).toEqual([429, true]);
  });

  it.each([
    ["ADMIN_LOGIN_IP_LIMIT", "100000"],
    ["ADMIN_LOGIN_IP_LIMIT", "0"],
    ["ADMIN_LOGIN_ACCOUNT_IP_LIMIT", "500"],
    ["ADMIN_LOGIN_ACCOUNT_LIMIT", "-1"],
    ["ADMIN_LOGIN_WINDOW_SECONDS", "1"],
    ["ADMIN_LOGIN_WINDOW_SECONDS", "abc"],
  ])("refuses to run with an unsafe value (%s=%s)", async (name, value) => {
    vi.stubEnv(name, value);
    resetEnvCache();
    expect((await attempt(OWNER, PASSWORD)).status).toBe(503);
  });
});

/* ---------- What must not change ---------- */

describe("sessions, roles and customers are unchanged", () => {
  it.each([
    ["owner", OWNER],
    ["manager", "manager@test.in"],
  ])("%s signs in with the same permissions; session, refresh and logout work", async (roleKey, email) => {
    useUpstash();
    production();
    const r = await attempt(email, PASSWORD);
    expect(r.status).toBe(200);
    expect(r.body.data!.admin).toMatchObject({ email, role: { key: roleKey } });
    expect([...r.body.data!.admin!.permissions].sort()).toEqual([...DEFAULT_ROLE_PERMISSIONS[roleKey as "owner" | "manager"]].sort());
    expect(r.res.cookies.get(ADMIN_ACCESS_COOKIE)).toMatchObject({ httpOnly: true, sameSite: "strict", secure: true, path: "/" });
    expect((await me(request("/api/v1/admin/auth/me", { method: "GET", jar: r.jar }), ctx)).status).toBe(200);
    const rotated = (await refresh(request("/api/v1/admin/auth/refresh", { jar: r.jar }), ctx)) as NextResponse;
    expect(rotated.status).toBe(200);
    const jar = { ...r.jar, ...Object.fromEntries(rotated.cookies.getAll().map((c) => [c.name, c.value])) };
    expect(jar[ADMIN_REFRESH_COOKIE]).not.toBe(r.jar[ADMIN_REFRESH_COOKIE]);
    expect((await logout(request("/api/v1/admin/auth/logout", { jar }), ctx)).status).toBe(200);
    expect((await me(request("/api/v1/admin/auth/me", { method: "GET", jar }), ctx)).status).toBe(401);
  });

  it("an existing session keeps working while sign-in is limited or the limiter is down", async () => {
    useUpstash();
    production();
    const r = await attempt(OWNER, PASSWORD);
    await times(PAIR_LIMIT + 2, () => attempt(OWNER));
    expect((await me(request("/api/v1/admin/auth/me", { method: "GET", jar: r.jar }), ctx)).status).toBe(200);
    redis.mode = "down";
    expect((await me(request("/api/v1/admin/auth/me", { method: "GET", jar: r.jar }), ctx)).status).toBe(200);
    expect((await refresh(request("/api/v1/admin/auth/refresh", { jar: r.jar }), ctx)).status).toBe(200);
  });

  it("customer sign-in doesn't depend on the admin limiter", async () => {
    await User.deleteMany({});
    await User.create({ fullName: "Asha Menon", email: "asha@example.in", mobile: "9876543210", passwordHash: hash });
    production(); // no Upstash: admin sign-in is refused…
    expect((await attempt(OWNER, PASSWORD)).status).toBe(503);
    const r = await customerLogin(request("/api/v1/auth/login", { body: { identifier: "asha@example.in", password: PASSWORD, remember: true }, headers: from("203.0.113.90") }), ctx);
    expect(r.status).toBe(200); // …while customers behave exactly as before
  });
});
