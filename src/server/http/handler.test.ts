import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ApiFailure, ApiSuccess } from "@/types/api";
import { AppError, ConfigError, notFound, tooManyRequests } from "./errors";
import { withApi } from "./handler";
import { ok } from "./response";
import { parseBody } from "@/server/validation/request";

const req = (init?: ConstructorParameters<typeof NextRequest>[1], url = "http://localhost/api/v1/test?token=abc") =>
  new NextRequest(url, init);
const ctx = <P>(params: P) => ({ params: Promise.resolve(params) });

afterEach(() => vi.restoreAllMocks());

describe("withApi", () => {
  it("passes awaited params and sets request id + no-store", async () => {
    const GET = withApi<{ id: string }>((_r, { params }) => ok({ id: params.id }, "Found"));
    const res = await GET(req(), ctx({ id: "42" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
    const body = (await res.json()) as ApiSuccess<{ id: string }>;
    expect(body).toEqual({ success: true, message: "Found", data: { id: "42" } });
  });

  it("keeps a handler's own Cache-Control", async () => {
    const GET = withApi(() => ok([], "OK", { headers: { "Cache-Control": "public, s-maxage=60" } }));
    const res = await GET(req(), ctx({}));
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=60");
  });

  it("maps AppError to its status, code and safe message", async () => {
    const GET = withApi(() => {
      throw notFound("Product not found.");
    });
    const res = await GET(req(), ctx({}));
    const body = (await res.json()) as ApiFailure;
    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.message).toBe("Product not found.");
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.requestId).toBe(res.headers.get("X-Request-Id"));
  });

  it("adds Retry-After for rate limits", async () => {
    const GET = withApi(() => {
      throw tooManyRequests(12.2);
    });
    const res = await GET(req(), ctx({}));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("13");
  });

  it("turns validation failures into 400 with field issues", async () => {
    const POST = withApi(async (r) => ok(await parseBody(r, z.object({ name: z.string().min(2) }))));
    const res = await POST(
      req({ method: "POST", body: JSON.stringify({ name: "x" }), headers: { "content-type": "application/json" } }),
      ctx({}),
    );
    const body = (await res.json()) as ApiFailure;
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.issues?.[0].path).toBe("name");
  });

  it("hides unknown errors behind a generic 500 and logs them without the query string", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const GET = withApi(() => {
      throw new Error("connection string mongodb://admin:hunter2@db leaked");
    });
    const res = await GET(req(), ctx({}));
    const body = (await res.json()) as ApiFailure;
    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("hunter2");
    const logged = String(spy.mock.calls[0]?.[0]);
    expect(logged).toContain('"path":"/api/v1/test"');
    expect(logged).not.toContain("token=abc");
  });

  it("maps duplicate-key and connection errors from MongoDB", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const dup = Object.assign(new Error("E11000 duplicate key error collection: users index: email_1"), { code: 11000 });
    const net = Object.assign(new Error("getaddrinfo ENOTFOUND cluster0"), { name: "MongooseServerSelectionError" });
    const res1 = await withApi(() => Promise.reject(dup))(req(), ctx({}));
    const res2 = await withApi(() => Promise.reject(net))(req(), ctx({}));
    expect(res1.status).toBe(409);
    expect(JSON.stringify(await res1.json())).not.toContain("email_1");
    expect(res2.status).toBe(503);
    expect(((await res2.json()) as ApiFailure).error.code).toBe("DATABASE_UNAVAILABLE");
  });

  it("returns a generic 503 for missing configuration", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await withApi(() => {
      throw new ConfigError("database", ["MONGODB_URI is required"]);
    })(req(), ctx({}));
    const body = (await res.json()) as ApiFailure;
    expect(res.status).toBe(503);
    expect(body.message).not.toContain("MONGODB_URI");
    expect(String(spy.mock.calls[0]?.[0])).toContain("MONGODB_URI");
  });

  it("logs server-side AppErrors but not client errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await withApi(() => {
      throw new AppError(400, "BAD_REQUEST", "nope");
    })(req(), ctx({}));
    expect(spy).not.toHaveBeenCalled();
  });
});
