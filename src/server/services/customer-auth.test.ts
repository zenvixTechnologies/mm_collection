import { MongoMemoryServer } from "mongodb-memory-server";
import { NextRequest, type NextResponse } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as deleteAddr, PUT as putAddr } from "@/app/api/v1/account/addresses/[id]/route";
import { POST as setDefault } from "@/app/api/v1/account/addresses/[id]/default/route";
import { GET as listAddr, POST as addAddr } from "@/app/api/v1/account/addresses/route";
import { GET as adminMe } from "@/app/api/v1/admin/auth/me/route";
import { POST as changePassword } from "@/app/api/v1/auth/change-password/route";
import { POST as forgot } from "@/app/api/v1/auth/forgot-password/route";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as logout } from "@/app/api/v1/auth/logout/route";
import { POST as logoutAll } from "@/app/api/v1/auth/logout-all/route";
import { GET as me, PATCH as patchMe } from "@/app/api/v1/auth/me/route";
import { POST as refresh } from "@/app/api/v1/auth/refresh/route";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as reset } from "@/app/api/v1/auth/reset-password/route";
import { DELETE as revokeSessionRoute } from "@/app/api/v1/auth/sessions/[id]/route";
import { GET as listSessions } from "@/app/api/v1/auth/sessions/route";
import { ADMIN_ACCESS_COOKIE, CUSTOMER_ACCESS_COOKIE, CUSTOMER_HINT_COOKIE, CUSTOMER_REFRESH_COOKIE, CUSTOMER_REFRESH_PATH } from "@/server/auth/cookies";
import { resetEnvCache } from "@/server/config/env";
import { connectToDatabase, disconnectFromDatabase } from "@/server/db/connect";
import { Session, User } from "@/server/models";
import { resetRateLimits } from "@/server/security/rate-limit";

const ORIGIN = "http://localhost:3000";
const PW = "Kerala2026";
const ctx = <P extends Record<string, string>>(params: P = {} as P) => ({ params: Promise.resolve(params) });
let mongo: MongoMemoryServer;
let ipSeq = 0;

type Jar = Record<string, string>;

function req(path: string, init: { method?: string; body?: unknown; jar?: Jar; origin?: string | null; ip?: string } = {}) {
  const headers: Record<string, string> = { "user-agent": "vitest", "x-forwarded-for": init.ip ?? `10.0.0.${++ipSeq % 250}` };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  if (init.jar) headers.cookie = Object.entries(init.jar).map(([k, v]) => `${k}=${v}`).join("; ");
  return new NextRequest(`${ORIGIN}${path}`, { method: init.method ?? "POST", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}
const cookiesOf = (res: Response): Jar => Object.fromEntries((res as NextResponse).cookies.getAll().filter((c) => c.value).map((c) => [c.name, c.value]));
const json = async (res: Response) => (await res.clone().json()) as { success: boolean; message: string; data: any; error?: { code: string; issues?: unknown[] } }; // eslint-disable-line @typescript-eslint/no-explicit-any

const customer = { fullName: "Asha Menon", email: "asha@example.in", mobile: "+91 98765 43210", password: PW };
const KOCHI = { house: "12B Lotus Residency", street: "Panampilly Nagar", city: "Kochi", district: "Ernakulam", state: "Kerala", pincode: "682036" };

async function signUp(over: Record<string, unknown> = {}) {
  const res = await register(req("/api/v1/auth/register", { body: { ...customer, ...over } }), ctx());
  return { res, jar: cookiesOf(res), body: await json(res) };
}
async function signIn(identifier = customer.email, password = PW, remember = true) {
  const res = await login(req("/api/v1/auth/login", { body: { identifier, password, remember } }), ctx());
  return { res, jar: cookiesOf(res), body: await json(res) };
}
const meStatus = async (jar: Jar) => (await me(req("/api/v1/auth/me", { method: "GET", jar }), ctx())).status;

/** Captures emails sent to Resend. */
function captureEmails() {
  const sent: { to: string[]; subject: string; text: string }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input) === "https://api.resend.com/emails") {
      sent.push(JSON.parse(String(init?.body)));
      return Response.json({ id: `email_${sent.length}` });
    }
    throw new Error(`Unexpected fetch ${String(input)}`);
  });
  return sent;
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  vi.stubEnv("MONGODB_URI", mongo.getUri());
  vi.stubEnv("MONGODB_DB_NAME", "mm-customer-test");
  vi.stubEnv("JWT_ACCESS_SECRET", "a".repeat(48));
  vi.stubEnv("JWT_REFRESH_SECRET", "r".repeat(48));
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("EMAIL_FROM", "M&M COLLECTIONS <orders@example.in>");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://shop.example.in");
  resetEnvCache();
  await connectToDatabase();
  await User.syncIndexes();
  await Session.syncIndexes();
}, 180_000);

beforeEach(async () => {
  await User.deleteMany({});
  await Session.deleteMany({});
  resetRateLimits();
  captureEmails();
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  await disconnectFromDatabase();
  await mongo?.stop();
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("registration", () => {
  it("creates the account, hashes the password, signs in with HttpOnly cookies", async () => {
    const { res, body } = await signUp();
    expect(res.status).toBe(201);
    expect(body.data.user).toMatchObject({ fullName: "Asha Menon", email: "asha@example.in", mobile: "9876543210", addresses: [] });
    expect(JSON.stringify(body)).not.toMatch(/password|Hash/i);
    const stored = await User.findOne().select("+passwordHash").lean();
    expect(stored!.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(stored!.passwordHash).not.toContain(PW);
    const c = (res as NextResponse).cookies;
    expect(c.get(CUSTOMER_ACCESS_COOKIE)).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/" });
    expect(c.get(CUSTOMER_REFRESH_COOKIE)).toMatchObject({ httpOnly: true, sameSite: "strict", path: CUSTOMER_REFRESH_PATH });
    expect(c.get(CUSTOMER_HINT_COOKIE)).toMatchObject({ value: "1", httpOnly: false });
  });

  it("validates input", async () => {
    for (const bad of [{ email: "not-an-email" }, { mobile: "12345" }, { password: "short1" }, { password: "lettersonly" }, { fullName: "A" }]) {
      expect((await signUp(bad)).res.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("prevents duplicate email or mobile", async () => {
    await signUp();
    const dupEmail = await signUp({ email: "ASHA@example.in", mobile: "9000000001" });
    const dupMobile = await signUp({ email: "other@example.in", mobile: "9876543210" });
    expect(dupEmail.res.status).toBe(409);
    expect(dupMobile.res.status).toBe(409);
    expect(await User.countDocuments()).toBe(1);
  });

  it("blocks cross-site sign-ups", async () => {
    expect((await register(req("/api/v1/auth/register", { body: customer, origin: "https://evil.example" }), ctx())).status).toBe(403);
  });
});

describe("login", () => {
  it("accepts email or mobile; rejects wrong passwords with a generic message", async () => {
    await signUp();
    expect((await signIn("Asha@Example.in")).res.status).toBe(200);
    expect((await signIn("98765 43210")).res.status).toBe(200);
    const wrong = await signIn(customer.email, "Wrong-pass-1");
    const unknown = await signIn("nobody@example.in");
    expect(wrong.res.status).toBe(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  it("locks after 5 failed attempts", async () => {
    await signUp();
    for (let i = 0; i < 5; i++) await signIn(customer.email, "Wrong-pass-1");
    expect((await signIn()).res.status).toBe(423);
  });

  it("rate-limits repeated attempts from one IP (429 with Retry-After)", async () => {
    let last: Response | undefined;
    for (let i = 0; i < 6; i++) last = await login(req("/api/v1/auth/login", { body: { identifier: "x@example.in", password: "x" }, ip: "203.0.113.9" }), ctx());
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("refuses suspended accounts", async () => {
    await signUp();
    await User.updateOne({}, { status: "blocked" });
    expect((await signIn()).res.status).toBe(403);
  });

  it("without 'Remember me', cookies end with the browser session", async () => {
    await signUp();
    const { res } = await signIn(customer.email, PW, false);
    expect((res as NextResponse).cookies.get(CUSTOMER_REFRESH_COOKIE)?.maxAge).toBeUndefined();
    expect((await Session.findOne({ persistent: false }).lean())).toBeTruthy();
  });
});

describe("tokens and sessions", () => {
  it("rotates refresh tokens and detects reuse", async () => {
    const { jar } = await signUp();
    const r1 = await refresh(req("/api/v1/auth/refresh", { jar }), ctx());
    expect(r1.status).toBe(200);
    const next = cookiesOf(r1);
    expect(next[CUSTOMER_REFRESH_COOKIE]).not.toBe(jar[CUSTOMER_REFRESH_COOKIE]);
    expect(await meStatus(next)).toBe(200);
    await Session.updateOne({}, { lastUsedAt: new Date(Date.now() - 60_000) });
    expect((await refresh(req("/api/v1/auth/refresh", { jar }), ctx())).status).toBe(401); // replayed old token
    expect((await Session.findOne().lean())!.revokedReason).toBe("reuse_detected");
    expect(await meStatus(next)).toBe(401);
  });

  it("logout revokes the session; logout-all revokes every device", async () => {
    const a = await signUp();
    const b = await signIn();
    expect((await logout(req("/api/v1/auth/logout", { jar: a.jar }), ctx())).status).toBe(200);
    expect(await meStatus(a.jar)).toBe(401);
    expect(await meStatus(b.jar)).toBe(200);
    const c = await signIn();
    expect((await logoutAll(req("/api/v1/auth/logout-all", { jar: c.jar }), ctx())).status).toBe(200);
    expect(await meStatus(b.jar)).toBe(401);
  });

  it("lists sessions and revokes only your own", async () => {
    const a = await signUp();
    const b = await signIn();
    const list = await json(await listSessions(req("/api/v1/auth/sessions", { method: "GET", jar: a.jar }), ctx()));
    expect(list.data).toHaveLength(2);
    const other = list.data.find((s: { current: boolean }) => !s.current);
    expect((await revokeSessionRoute(req(`/api/v1/auth/sessions/${other.id}`, { method: "DELETE", jar: a.jar }), ctx({ id: other.id }))).status).toBe(200);
    expect(await meStatus(b.jar)).toBe(401);

    // Someone else can't revoke Asha's session.
    const eve = await signUp({ email: "eve@example.in", mobile: "9000000002" });
    const ashaSession = (await Session.findOne({ revokedAt: null, subject: (await User.findOne({ email: customer.email }))!._id }).lean())!;
    const res = await revokeSessionRoute(req(`/api/v1/auth/sessions/${ashaSession._id}`, { method: "DELETE", jar: eve.jar }), ctx({ id: ashaSession._id.toString() }));
    expect(res.status).toBe(404);
    expect(await meStatus(a.jar)).toBe(200);
  });

  it("keeps customers and admins completely separate", async () => {
    const { jar } = await signUp();
    // Customer token presented as an admin token → rejected by admin APIs.
    const asAdmin = await adminMe(req("/api/v1/admin/auth/me", { method: "GET", jar: { [ADMIN_ACCESS_COOKIE]: jar[CUSTOMER_ACCESS_COOKIE] } }), ctx());
    expect(asAdmin.status).toBe(401);
    // And a customer cookie alone grants nothing on admin APIs.
    expect((await adminMe(req("/api/v1/admin/auth/me", { method: "GET", jar }), ctx())).status).toBe(401);
  });
});

describe("profile", () => {
  it("updates name and mobile; email change needs the current password", async () => {
    const { jar } = await signUp();
    let res = await patchMe(req("/api/v1/auth/me", { method: "PATCH", jar, body: { fullName: "Asha K Menon", mobile: "9123456789" } }), ctx());
    expect((await json(res)).data.user).toMatchObject({ fullName: "Asha K Menon", mobile: "9123456789" });
    res = await patchMe(req("/api/v1/auth/me", { method: "PATCH", jar, body: { email: "new@example.in" } }), ctx());
    expect(res.status).toBe(400);
    res = await patchMe(req("/api/v1/auth/me", { method: "PATCH", jar, body: { email: "new@example.in", currentPassword: PW } }), ctx());
    expect((await json(res)).data.user.email).toBe("new@example.in");
  });

  it("refuses an email or mobile already used by another account", async () => {
    await signUp({ email: "taken@example.in", mobile: "9000000003" });
    const { jar } = await signUp();
    expect((await patchMe(req("/api/v1/auth/me", { method: "PATCH", jar, body: { mobile: "9000000003" } }), ctx())).status).toBe(409);
    expect((await patchMe(req("/api/v1/auth/me", { method: "PATCH", jar, body: { email: "taken@example.in", currentPassword: PW } }), ctx())).status).toBe(409);
  });

  it("changes the password and signs out other devices", async () => {
    const a = await signUp();
    const b = await signIn();
    const res = await changePassword(req("/api/v1/auth/change-password", { jar: a.jar, body: { currentPassword: PW, newPassword: "Kochi2027x" } }), ctx());
    expect((await json(res)).data.otherSessionsSignedOut).toBe(1);
    expect(await meStatus(a.jar)).toBe(200);
    expect(await meStatus(b.jar)).toBe(401);
    expect((await signIn(customer.email, "Kochi2027x")).res.status).toBe(200);
  });
});

describe("forgot / reset password", () => {
  it("answers identically for unknown emails and sends nothing", async () => {
    const sent = captureEmails();
    const res = await forgot(req("/api/v1/auth/forgot-password", { body: { email: "nobody@example.in" } }), ctx());
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(0);
  });

  it("emails a single-use, hashed, expiring link that resets the password and signs out everywhere", async () => {
    const a = await signUp();
    const sent = captureEmails();
    const res = await forgot(req("/api/v1/auth/forgot-password", { body: { email: "ASHA@example.in" } }), ctx());
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["asha@example.in"]);
    const token = /reset-password\?token=([A-Za-z0-9_-]+)/.exec(sent[0].text)![1];
    expect(sent[0].text).toContain("https://shop.example.in/reset-password?token=");

    const stored = await User.findOne().select("+passwordReset").lean();
    expect(stored!.passwordReset!.tokenHash).not.toBe(token); // only a hash is stored

    expect((await reset(req("/api/v1/auth/reset-password", { body: { token, password: "short" } }), ctx())).status).toBe(400);
    expect((await reset(req("/api/v1/auth/reset-password", { body: { token, password: "NewPass2026" } }), ctx())).status).toBe(200);
    expect(await meStatus(a.jar)).toBe(401); // all sessions revoked
    expect((await signIn(customer.email, "NewPass2026")).res.status).toBe(200);
    expect((await signIn(customer.email, PW)).res.status).toBe(401);
    // Single use.
    expect((await reset(req("/api/v1/auth/reset-password", { body: { token, password: "Another2026" } }), ctx())).status).toBe(400);
  });

  it("rejects expired tokens and sends at most one email per minute per account", async () => {
    await signUp();
    const sent = captureEmails();
    await forgot(req("/api/v1/auth/forgot-password", { body: { email: customer.email } }), ctx());
    await forgot(req("/api/v1/auth/forgot-password", { body: { email: customer.email } }), ctx());
    expect(sent).toHaveLength(1);
    const token = /token=([A-Za-z0-9_-]+)/.exec(sent[0].text)![1];
    await User.updateOne({}, { "passwordReset.expiresAt": new Date(Date.now() - 1000) });
    expect((await reset(req("/api/v1/auth/reset-password", { body: { token, password: "NewPass2026" } }), ctx())).status).toBe(400);
  });

  it("still succeeds (and doesn't leak) when email delivery is not configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    resetEnvCache();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await signUp();
    const res = await forgot(req("/api/v1/auth/forgot-password", { body: { email: customer.email } }), ctx());
    expect(res.status).toBe(200);
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    resetEnvCache();
  });
});

describe("addresses", () => {
  const add = (jar: Jar, body: Record<string, unknown>) => addAddr(req("/api/v1/account/addresses", { jar, body }), ctx());

  it("adds (first is default), edits, sets default and deletes", async () => {
    const { jar } = await signUp();
    let res = await add(jar, KOCHI);
    expect(res.status).toBe(201);
    let list = (await json(res)).data;
    expect(list[0]).toMatchObject({ ...KOCHI, isDefault: true });
    res = await add(jar, { ...KOCHI, house: "Flat 9", city: "Thrissur", district: "Thrissur", pincode: "680001", label: "Work" });
    list = (await json(res)).data;
    const work = list.find((a: { label: string }) => a.label === "Work");
    expect(work.isDefault).toBe(false);

    res = await setDefault(req(`/api/v1/account/addresses/${work.id}/default`, { jar }), ctx({ id: work.id }));
    list = (await json(res)).data;
    expect(list[0]).toMatchObject({ id: work.id, isDefault: true }); // default first
    expect(list.filter((a: { isDefault: boolean }) => a.isDefault)).toHaveLength(1);

    res = await putAddr(req(`/api/v1/account/addresses/${work.id}`, { method: "PUT", jar, body: { ...KOCHI, house: "Flat 10", label: "Work" } }), ctx({ id: work.id }));
    expect((await json(res)).data[0].house).toBe("Flat 10");

    res = await deleteAddr(req(`/api/v1/account/addresses/${work.id}`, { method: "DELETE", jar }), ctx({ id: work.id }));
    list = (await json(res)).data;
    expect(list).toHaveLength(1);
    expect(list[0].isDefault).toBe(true); // default moves to the remaining address
  });

  it("accepts Indian addresses only", async () => {
    const { jar } = await signUp();
    expect((await add(jar, { ...KOCHI, state: "California" })).status).toBe(400);
    expect((await add(jar, { ...KOCHI, pincode: "012345" })).status).toBe(400);
    expect((await add(jar, { ...KOCHI, country: "USA" })).status).toBe(400);
  });

  it("customers can't read or change each other's addresses", async () => {
    const asha = await signUp();
    const list = (await json(await add(asha.jar, KOCHI))).data;
    const id = list[0].id;
    const eve = await signUp({ email: "eve@example.in", mobile: "9000000004" });
    expect((await json(await listAddr(req("/api/v1/account/addresses", { method: "GET", jar: eve.jar }), ctx()))).data).toHaveLength(0);
    expect((await putAddr(req(`/api/v1/account/addresses/${id}`, { method: "PUT", jar: eve.jar, body: { ...KOCHI, house: "Hacked" } }), ctx({ id }))).status).toBe(404);
    expect((await deleteAddr(req(`/api/v1/account/addresses/${id}`, { method: "DELETE", jar: eve.jar }), ctx({ id }))).status).toBe(404);
    expect((await User.findOne({ email: customer.email }).lean())!.addresses[0].address.house).toBe(KOCHI.house);
  });

  it("requires sign-in", async () => {
    expect((await listAddr(req("/api/v1/account/addresses", { method: "GET" }), ctx())).status).toBe(401);
  });
});
