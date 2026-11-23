import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "@/server/http/errors";
import { address, email, indianMobile, objectId, pagination, queryBoolean, skipFor } from "./common";
import { parseBody, parseParams, parseQuery } from "./request";

const jsonReq = (body: string, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/v1/x", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", ...headers },
  });

async function codeOf(p: Promise<unknown> | (() => unknown)) {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (err) {
    return err instanceof AppError ? `${err.status}:${err.code}` : "other";
  }
  return "none";
}

describe("parseBody", () => {
  const schema = z.object({ qty: z.number().int().min(1) });

  it("parses valid JSON", async () => {
    await expect(parseBody(jsonReq('{"qty":2}'), schema)).resolves.toEqual({ qty: 2 });
  });

  it("rejects malformed JSON, wrong content type and oversized bodies", async () => {
    expect(await codeOf(parseBody(jsonReq("{qty:"), schema))).toBe("400:INVALID_JSON");
    expect(await codeOf(parseBody(jsonReq('{"qty":1}', { "content-type": "text/plain" }), schema))).toBe(
      "415:UNSUPPORTED_MEDIA_TYPE",
    );
    expect(await codeOf(parseBody(jsonReq(JSON.stringify({ qty: 1, pad: "x".repeat(200) })), schema, { maxBytes: 100 }))).toBe(
      "413:PAYLOAD_TOO_LARGE",
    );
  });

  it("reports field issues", async () => {
    expect(await codeOf(parseBody(jsonReq('{"qty":0}'), schema))).toBe("400:VALIDATION_ERROR");
  });
});

describe("parseQuery", () => {
  it("coerces pagination and collects repeated keys", () => {
    const schema = pagination.extend({ size: z.array(z.string()).or(z.string()).optional(), inStock: queryBoolean.optional() });
    const q = parseQuery(new Request("http://x/api?page=3&limit=50&size=M&size=L&inStock=1"), schema);
    expect(q).toEqual({ page: 3, limit: 50, size: ["M", "L"], inStock: true });
    expect(skipFor(q)).toBe(100);
  });

  it("applies defaults and caps the page size", async () => {
    expect(parseQuery(new Request("http://x/api"), pagination)).toEqual({ page: 1, limit: 20 });
    expect(await codeOf(() => parseQuery(new Request("http://x/api?limit=500"), pagination))).toBe("400:VALIDATION_ERROR");
  });
});

describe("parseParams", () => {
  it("validates ObjectIds", async () => {
    expect(parseParams({ id: "65a1b2c3d4e5f60718293a4b" }, z.object({ id: objectId }))).toEqual({
      id: "65a1b2c3d4e5f60718293a4b",
    });
    expect(await codeOf(() => parseParams({ id: "p001" }, z.object({ id: objectId })))).toBe("400:VALIDATION_ERROR");
  });
});

describe("common schemas", () => {
  it("normalises Indian mobile numbers and emails", () => {
    expect(indianMobile.parse("+91 98765 43210")).toBe("9876543210");
    expect(indianMobile.safeParse("12345").success).toBe(false);
    expect(email.parse("  Asha@Example.IN ")).toBe("asha@example.in");
  });

  it("accepts Indian addresses only", () => {
    const base = { house: "12", street: "MG Road", city: "Kochi", district: "Ernakulam", state: "Kerala", pincode: "682016" };
    expect(address.parse(base).country).toBe("India");
    expect(address.safeParse({ ...base, country: "USA" }).success).toBe(false);
    expect(address.safeParse({ ...base, state: "California" }).success).toBe(false);
    expect(address.safeParse({ ...base, pincode: "012345" }).success).toBe(false);
  });
});
