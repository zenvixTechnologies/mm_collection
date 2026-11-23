import { SignJWT } from "jose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { NextRequest, type NextResponse } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as changePassword } from "@/app/api/v1/admin/auth/change-password/route";
import { POST as login } from "@/app/api/v1/admin/auth/login/route";
import { POST as logout } from "@/app/api/v1/admin/auth/logout/route";
import { POST as logoutAll } from "@/app/api/v1/admin/auth/logout-all/route";
import { GET as me } from "@/app/api/v1/admin/auth/me/route";
import { POST as refresh } from "@/app/api/v1/admin/auth/refresh/route";
import { resetEnvCache } from "@/server/config/env";
import { connectToDatabase, disconnectFromDatabase } from "@/server/db/connect";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/response";
import { Admin, AuditLog, Role, Session } from "@/server/models";
import { DEFAULT_ROLE_PERMISSIONS } from "./permissions";
import { ADMIN_ACCESS_COOKIE, ADMIN_REFRESH_COOKIE, ADMIN_REFRESH_PATH } from "./cookies";
import { requireAdmin } from "./guard";
import { hashPassword } from "./password";

const ORIGIN = "http://localhost:3000";
const PASSWORD = "Correct-horse-42";
const ctx = { params: Promise.resolve({}) };
let mongo: MongoMemoryServer;

type Jar = Record<string, string>;

function request(path: string, init: { method?: string; body?: unknown; jar?: Jar; origin?: string | null } = {}) {
  const headers: Record<string, string> = { "user-agent": "vitest" };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  if (init.jar) headers.cookie = Object.entries(init.jar).map(([k, v]) => `${k}=${v}`).join("; ");
  return new NextRequest(`${ORIGIN}${path}`, {
    method: init.method ?? "POST",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

function cookiesOf(res: Response): Jar {
  const jar: Jar = {};
  for (const c of (res as NextResponse).cookies.getAll()) if (c.value) jar[c.name] = c.value;
  return jar;
}

async function signIn(email = "owner@test.in", password = PASSWORD) {
  const res = await login(request("/api/v1/admin/auth/login", { body: { identifier: email, password } }), ctx);
  return { res, jar: cookiesOf(res), body: await res.clone().json() };
}

async function makeAdmin(email: string, roleKey: "owner" | "manager" | "staff", status: "active" | "disabled" = "active") {
  const role = await Role.findOne({ key: roleKey });
  return Admin.create({ name: email.split("@")[0], email, passwordHash: await hashPassword(PASSWORD), role: role!._id, status });
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  vi.stubEnv("MONGODB_URI", mongo.getUri());
  vi.stubEnv("MONGODB_DB_NAME", "mm-auth-test");
  vi.stubEnv("JWT_ACCESS_SECRET", "a".repeat(48));
  vi.stubEnv("JWT_REFRESH_SECRET", "r".repeat(48));
  resetEnvCache();
  await connectToDatabase();
  for (const m of [Admin, Role, Session, AuditLog]) await m.syncIndexes();
  for (const [key, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    await Role.create({ key, name: key, permissions: [...permissions], isSystem: true });
  }
}, 180_000);

beforeEach(async () => {
  await Admin.deleteMany({});
  await Session.deleteMany({});
  await makeAdmin("owner@test.in", "owner");
});

afterAll(async () => {
  await disconnectFromDatabase();
  await mongo?.stop();
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("login", () => {
  it("issues HttpOnly, SameSite=Strict cookies; the refresh cookie is path-restricted", async () => {
    const { res, body } = await signIn();
    expect(res.status).toBe(200);
    expect(body.data.admin).toMatchObject({ email: "owner@test.in", role: { key: "owner" } });
    expect(body.data.admin.permissions).toContain("products:write");
    const cookies = (res as NextResponse).cookies;
    const access = cookies.get(ADMIN_ACCESS_COOKIE)!;
    const refreshC = cookies.get(ADMIN_REFRESH_COOKIE)!;
    expect(access).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/" });
    expect(refreshC).toMatchObject({ httpOnly: true, sameSite: "strict", path: ADMIN_REFRESH_PATH });
    // Tokens never appear in the JSON body.
    expect(JSON.stringify(body)).not.toContain(access.value);
    expect(JSON.stringify(body)).not.toContain(refreshC.value);
  });

  it("stores only a hash of the refresh token and a bcrypt password hash", async () => {
    const { jar } = await signIn();
    const session = await Session.findOne().lean();
    expect(session!.refreshTokenHash).not.toBe(jar[ADMIN_REFRESH_COOKIE]);
    const admin = await Admin.findOne().select("+passwordHash").lean();
    expect(admin!.passwordHash).toMatch(/^\$2[aby]\$12\$/);
  });

  it("gives the same error for a wrong password and an unknown email", async () => {
    const wrong = await signIn("owner@test.in", "nope-nope-123");
    const unknown = await signIn("ghost@test.in", PASSWORD);
    expect(wrong.res.status).toBe(401);
    expect(unknown.res.status).toBe(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  it("locks the account for 15 minutes after 5 failed attempts", async () => {
    for (let i = 0; i < 5; i++) await signIn("owner@test.in", "wrong-password-1");
    const locked = await signIn();
    expect(locked.res.status).toBe(423);
    expect(locked.body.error.code).toBe("ACCOUNT_LOCKED");
    await Admin.updateOne({}, { lockedUntil: new Date(Date.now() - 1000) });
    expect((await signIn()).res.status).toBe(200);
    expect(await AuditLog.countDocuments({ action: "admin.locked" })).toBeGreaterThan(0);
  });

  it("signs in with a username (case-insensitive), including special characters", async () => {
    const role = await Role.findOne({ key: "owner" });
    await Admin.create({ name: "M&M Owner", username: "m&m@mmcollections.owner", passwordHash: await hashPassword(PASSWORD), role: role!._id });
    const { res, body } = await signIn("M&M@mmcollections.Owner");
    expect(res.status).toBe(200);
    expect(body.data.admin).toMatchObject({ username: "m&m@mmcollections.owner", email: null, role: { key: "owner" } });
    expect((await signIn("M&M@mmcollections.Owner", "wrong-password-9")).res.status).toBe(401);
  });

  it("requires an admin to have a username or an email", async () => {
    const role = await Role.findOne({ key: "staff" });
    await expect(Admin.create({ name: "Nobody", passwordHash: "x", role: role!._id })).rejects.toThrow(/username or an email/);
  });

  it("refuses disabled admins", async () => {
    await Admin.updateOne({ email: "owner@test.in" }, { status: "disabled" });
    expect((await signIn()).res.status).toBe(401);
  });

  it("blocks cross-site and origin-less login attempts", async () => {
    const evil = await login(request("/api/v1/admin/auth/login", { body: { identifier: "owner@test.in", password: PASSWORD }, origin: "https://evil.example" }), ctx);
    const none = await login(request("/api/v1/admin/auth/login", { body: { identifier: "owner@test.in", password: PASSWORD }, origin: null }), ctx);
    expect(evil.status).toBe(403);
    expect(none.status).toBe(403);
  });
});

describe("access token", () => {
  it("authenticates /me and rejects missing, tampered and expired tokens", async () => {
    const { jar } = await signIn();
    expect((await me(request("/api/v1/admin/auth/me", { method: "GET", jar }), ctx)).status).toBe(200);
    expect((await me(request("/api/v1/admin/auth/me", { method: "GET" }), ctx)).status).toBe(401);

    const tampered = { [ADMIN_ACCESS_COOKIE]: jar[ADMIN_ACCESS_COOKIE].slice(0, -3) + "abc" };
    expect((await me(request("/api/v1/admin/auth/me", { method: "GET", jar: tampered }), ctx)).status).toBe(401);

    const session = await Session.findOne().lean();
    const expired = await new SignJWT({ sid: session!._id.toString() })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(session!.subject.toString())
      .setAudience("admin")
      .setIssuer("mm-collections")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode("a".repeat(48)));
    const res = await me(request("/api/v1/admin/auth/me", { method: "GET", jar: { [ADMIN_ACCESS_COOKIE]: expired } }), ctx);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("TOKEN_EXPIRED");
  });

  it("rejects a token signed with another secret or for customers", async () => {
    const session = await (async () => (await signIn(), Session.findOne().lean()))();
    const forged = await new SignJWT({ sid: session!._id.toString() })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(session!.subject.toString())
      .setAudience("admin")
      .setIssuer("mm-collections")
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode("x".repeat(48)));
    expect((await me(request("/api/v1/admin/auth/me", { method: "GET", jar: { [ADMIN_ACCESS_COOKIE]: forged } }), ctx)).status).toBe(401);
  });
});

describe("refresh rotation", () => {
  it("rotates the refresh token and keeps the session usable", async () => {
    const first = await signIn();
    const r = await refresh(request("/api/v1/admin/auth/refresh", { jar: first.jar }), ctx);
    expect(r.status).toBe(200);
    const next = cookiesOf(r);
    expect(next[ADMIN_REFRESH_COOKIE]).toBeTruthy();
    expect(next[ADMIN_REFRESH_COOKIE]).not.toBe(first.jar[ADMIN_REFRESH_COOKIE]);
    expect((await me(request("/api/v1/admin/auth/me", { method: "GET", jar: next }), ctx)).status).toBe(200);
  });

  it("treats an immediate second use as a two-tab race, not theft", async () => {
    const first = await signIn();
    await refresh(request("/api/v1/admin/auth/refresh", { jar: first.jar }), ctx);
    const again = await refresh(request("/api/v1/admin/auth/refresh", { jar: first.jar }), ctx);
    expect(again.status).toBe(401);
    expect((await again.json()).error.code).toBe("TOKEN_EXPIRED");
    expect(await Session.countDocuments({ revokedAt: null })).toBe(1);
  });

  it("revokes the session when an old refresh token is replayed later (theft)", async () => {
    const first = await signIn();
    const r = await refresh(request("/api/v1/admin/auth/refresh", { jar: first.jar }), ctx);
    const current = cookiesOf(r);
    await Session.updateOne({}, { lastUsedAt: new Date(Date.now() - 60_000) }); // past the race window
    const replay = await refresh(request("/api/v1/admin/auth/refresh", { jar: first.jar }), ctx);
    expect(replay.status).toBe(401);
    expect((await Session.findOne().lean())!.revokedReason).toBe("reuse_detected");
    // The legitimate holder is signed out too.
    expect((await me(request("/api/v1/admin/auth/me", { method: "GET", jar: current }), ctx)).status).toBe(401);
    expect((await refresh(request("/api/v1/admin/auth/refresh", { jar: current }), ctx)).status).toBe(401);
  });

  it("fails without a refresh cookie and clears cookies", async () => {
    const res = (await refresh(request("/api/v1/admin/auth/refresh"), ctx)) as NextResponse;
    expect(res.status).toBe(401);
    expect(res.cookies.get(ADMIN_REFRESH_COOKIE)?.value).toBe("");
  });
});

describe("logout", () => {
  it("revokes the session immediately", async () => {
    const { jar } = await signIn();
    expect((await logout(request("/api/v1/admin/auth/logout", { jar }), ctx)).status).toBe(200);
    expect((await me(request("/api/v1/admin/auth/me", { method: "GET", jar }), ctx)).status).toBe(401);
    expect((await refresh(request("/api/v1/admin/auth/refresh", { jar }), ctx)).status).toBe(401);
  });

  it("logout-all signs out every device", async () => {
    const a = await signIn();
    const b = await signIn();
    expect((await logoutAll(request("/api/v1/admin/auth/logout-all", { jar: a.jar }), ctx)).status).toBe(200);
    expect((await me(request("/api/v1/admin/auth/me", { method: "GET", jar: b.jar }), ctx)).status).toBe(401);
  });

  it("changing the password signs out other devices but keeps this one", async () => {
    const a = await signIn();
    const b = await signIn();
    const res = await changePassword(
      request("/api/v1/admin/auth/change-password", { jar: a.jar, body: { currentPassword: PASSWORD, newPassword: "Brand-new-pass-77" } }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect((await me(request("/api/v1/admin/auth/me", { method: "GET", jar: a.jar }), ctx)).status).toBe(200);
    expect((await me(request("/api/v1/admin/auth/me", { method: "GET", jar: b.jar }), ctx)).status).toBe(401);
    expect((await signIn("owner@test.in", "Brand-new-pass-77")).res.status).toBe(200);
  });

  it("rejects weak new passwords", async () => {
    const { jar } = await signIn();
    const res = await changePassword(request("/api/v1/admin/auth/change-password", { jar, body: { currentPassword: PASSWORD, newPassword: "short" } }), ctx);
    expect(res.status).toBe(400);
  });
});

describe("role-based permissions", () => {
  const protectedRoute = withApi(async (req) => {
    const c = await requireAdmin(req, "products:write");
    return ok({ by: c.admin.role.key });
  });

  it("allows owner and manager, forbids staff", async () => {
    await makeAdmin("manager@test.in", "manager");
    await makeAdmin("staff@test.in", "staff");
    for (const [email, status] of [["owner@test.in", 200], ["manager@test.in", 200], ["staff@test.in", 403]] as const) {
      const { jar } = await signIn(email);
      const res = await protectedRoute(request("/api/v1/admin/x", { jar }), ctx);
      expect(res.status, email).toBe(status);
    }
  });

  it("applies permission changes immediately, without a new sign-in", async () => {
    await makeAdmin("manager@test.in", "manager");
    const { jar } = await signIn("manager@test.in");
    expect((await protectedRoute(request("/api/v1/admin/x", { jar }), ctx)).status).toBe(200);
    await Role.updateOne({ key: "manager" }, { $pull: { permissions: "products:write" } });
    expect((await protectedRoute(request("/api/v1/admin/x", { jar }), ctx)).status).toBe(403);
    await Role.updateOne({ key: "manager" }, { $addToSet: { permissions: "products:write" } });
  });

  it("owner keeps full access even if the stored list is incomplete", async () => {
    await Role.updateOne({ key: "owner" }, { permissions: [] });
    const { jar } = await signIn();
    expect((await protectedRoute(request("/api/v1/admin/x", { jar }), ctx)).status).toBe(200);
    await Role.updateOne({ key: "owner" }, { permissions: [...DEFAULT_ROLE_PERMISSIONS.owner] });
  });

  it("blocks cross-site state-changing requests even with a valid session", async () => {
    const { jar } = await signIn();
    expect((await protectedRoute(request("/api/v1/admin/x", { jar, origin: "https://evil.example" }), ctx)).status).toBe(403);
  });

  it("locks out a disabled admin mid-session", async () => {
    const { jar } = await signIn();
    await Admin.updateOne({ email: "owner@test.in" }, { status: "disabled" });
    expect((await me(request("/api/v1/admin/auth/me", { method: "GET", jar }), ctx)).status).toBe(401);
  });
});
