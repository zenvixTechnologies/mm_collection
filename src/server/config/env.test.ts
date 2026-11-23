import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigError } from "@/server/http/errors";
import { envReport, findExposedPublicSecrets, getEnv, isConfigured, resetEnvCache } from "./env";

beforeEach(() => resetEnvCache());
afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("getEnv", () => {
  it("returns validated database settings with defaults", () => {
    vi.stubEnv("MONGODB_URI", "mongodb+srv://user:pw@cluster0.example.mongodb.net/mm");
    vi.stubEnv("MONGODB_MAX_POOL_SIZE", "");
    const env = getEnv("database");
    expect(env.MONGODB_URI).toMatch(/^mongodb\+srv:/);
    expect(env.MONGODB_MAX_POOL_SIZE).toBe(10);
    expect(env.MONGODB_DB_NAME).toBeUndefined();
  });

  it("refuses to fall back to MongoDB's default \"test\" database", () => {
    vi.stubEnv("MONGODB_URI", "mongodb+srv://u:p@cluster0.example.mongodb.net/?retryWrites=true");
    vi.stubEnv("MONGODB_DB_NAME", "");
    expect(() => getEnv("database")).toThrow(ConfigError);
    vi.stubEnv("MONGODB_DB_NAME", "mm-collections-dev");
    resetEnvCache();
    expect(getEnv("database").MONGODB_DB_NAME).toBe("mm-collections-dev");
  });

  it("throws a ConfigError naming the variable but not its value", () => {
    vi.stubEnv("MONGODB_URI", "postgres://super-secret-value");
    try {
      getEnv("database");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const e = err as ConfigError;
      expect(e.status).toBe(503);
      expect(e.describe()).toContain("MONGODB_URI");
      expect(e.describe()).not.toContain("super-secret-value");
      expect(e.message).not.toContain("MONGODB_URI"); // client-facing message stays generic
    }
  });

  it("treats empty values as missing", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    expect(isConfigured("email")).toBe(false);
  });

  it("enforces minimum JWT secret length", () => {
    vi.stubEnv("JWT_ACCESS_SECRET", "short");
    vi.stubEnv("JWT_REFRESH_SECRET", "x".repeat(32));
    expect(() => getEnv("auth")).toThrow(ConfigError);
    vi.stubEnv("JWT_ACCESS_SECRET", "y".repeat(32));
    resetEnvCache();
    expect(getEnv("auth").JWT_ACCESS_SECRET).toHaveLength(32);
  });

  it("validates the Razorpay key format and keeps the webhook secret optional", () => {
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_abc123");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "s");
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "");
    expect(getEnv("razorpay").RAZORPAY_WEBHOOK_SECRET).toBeUndefined();
    vi.stubEnv("RAZORPAY_KEY_ID", "not-a-key");
    resetEnvCache();
    expect(isConfigured("razorpay")).toBe(false);
  });
});

describe("envReport", () => {
  it("lists problems by variable name only", () => {
    const report = envReport({ MONGODB_URI: "mongodb://localhost/x" });
    expect(report.database.ok).toBe(true);
    expect(report.cloudinary.ok).toBe(false);
    if (!report.cloudinary.ok) expect(report.cloudinary.problems.join(" ")).toContain("CLOUDINARY_API_SECRET");
  });
});

describe("findExposedPublicSecrets", () => {
  it("flags secrets put in NEXT_PUBLIC_ variables", () => {
    const found = findExposedPublicSecrets({
      NEXT_PUBLIC_APP_URL: "https://x.in",
      NEXT_PUBLIC_RAZORPAY_KEY_SECRET: "oops",
      NEXT_PUBLIC_MONGODB_URI: "oops",
      RAZORPAY_KEY_SECRET: "fine",
    });
    expect(found.sort()).toEqual(["NEXT_PUBLIC_MONGODB_URI", "NEXT_PUBLIC_RAZORPAY_KEY_SECRET"]);
  });
});
