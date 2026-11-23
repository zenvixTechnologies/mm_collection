import "server-only";
import { z } from "zod";
import { ConfigError } from "@/server/http/errors";

/**
 * Server environment, validated per integration.
 *
 * Each integration is validated the first time it is used (`getEnv("database")`), so the app can
 * boot and build without, say, Resend configured — but the first request that needs a missing
 * integration fails with a clear server log and a generic 503 for the client.
 * `src/instrumentation.ts` also reports every integration's status once at server start-up.
 *
 * Secrets are read only here, only on the server. Never add a secret to a NEXT_PUBLIC_ variable.
 */

const str = z.string().trim().min(1, "is required");
const secret = (min: number) => z.string().min(min, `must be at least ${min} characters`);

const schemas = {
  app: z.object({
    NEXT_PUBLIC_APP_URL: z.url("must be a full URL, e.g. https://mmcollections.in").optional(),
  }),
  database: z.object({
    MONGODB_URI: str.regex(/^mongodb(\+srv)?:\/\//, "must start with mongodb:// or mongodb+srv://"),
    /** Overrides the database named in the URI. */
    MONGODB_DB_NAME: str.optional(),
    /** Connections per serverless instance. Keep small: many instances × pool size ≤ Atlas limit. */
    MONGODB_MAX_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  })
  // Without a database name the driver silently uses "test" — refuse instead.
  .refine((e) => !!e.MONGODB_DB_NAME || /^mongodb(\+srv)?:\/\/[^/]+\/[^/?]+/.test(e.MONGODB_URI), {
    path: ["MONGODB_DB_NAME"],
    message: "is required when MONGODB_URI doesn't name a database",
  }),
  auth: z.object({
    JWT_ACCESS_SECRET: secret(32),
    JWT_REFRESH_SECRET: secret(32),
  }),
  cloudinary: z.object({
    CLOUDINARY_CLOUD_NAME: str,
    CLOUDINARY_API_KEY: str,
    CLOUDINARY_API_SECRET: str,
  }),
  razorpay: z.object({
    RAZORPAY_KEY_ID: str.regex(/^rzp_(test|live)_[A-Za-z0-9]+$/, "must look like rzp_test_… or rzp_live_…"),
    RAZORPAY_KEY_SECRET: str,
    /** Required by the webhook endpoint only. */
    RAZORPAY_WEBHOOK_SECRET: str.optional(),
  }),
  upstash: z.object({
    UPSTASH_REDIS_REST_URL: z.url("must be the https REST URL from the Upstash console"),
    UPSTASH_REDIS_REST_TOKEN: str,
  }),
  email: z.object({
    RESEND_API_KEY: str,
    /** e.g. "M&M COLLECTIONS <orders@your-verified-domain.in>" */
    EMAIL_FROM: str,
  }),
  cron: z.object({
    /** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. */
    CRON_SECRET: secret(16),
  }),
} as const;

export type EnvGroup = keyof typeof schemas;
export type Env<G extends EnvGroup> = z.infer<(typeof schemas)[G]>;

type EnvSource = Record<string, string | undefined>;

const cache = new Map<EnvGroup, unknown>();

/** Treat `FOO=` (empty) the same as unset, so optional variables and defaults work. */
function readRaw(group: EnvGroup, source: EnvSource) {
  const out: Record<string, string | undefined> = {};
  for (const key of Object.keys(schemas[group].shape)) {
    const value = source[key];
    out[key] = value === undefined || value.trim() === "" ? undefined : value;
  }
  return out;
}

function check(group: EnvGroup, source: EnvSource = process.env) {
  const result = schemas[group].safeParse(readRaw(group, source));
  if (result.success) return { ok: true as const, data: result.data };
  // Name the variable and the rule; never echo the value. Env values are strings or unset,
  // so a type mismatch always means "not set".
  const problems = result.error.issues.map(
    (i) => `${i.path.map(String).join(".")} ${i.code === "invalid_type" ? "is not set" : i.message}`,
  );
  return { ok: false as const, problems };
}

/** Validated variables for one integration. Throws ConfigError (→ 503) if missing or invalid. */
export function getEnv<G extends EnvGroup>(group: G): Env<G> {
  if (cache.has(group)) return cache.get(group) as Env<G>;
  const result = check(group);
  if (!result.ok) throw new ConfigError(group, result.problems);
  cache.set(group, result.data);
  return result.data as Env<G>;
}

export function isConfigured(group: EnvGroup): boolean {
  return cache.has(group) || check(group).ok;
}

export type EnvReport = Record<EnvGroup, { ok: true } | { ok: false; problems: string[] }>;

/** Status of every integration — variable names and rules only, never values. */
export function envReport(source: EnvSource = process.env): EnvReport {
  const report = {} as EnvReport;
  for (const group of Object.keys(schemas) as EnvGroup[]) {
    const r = check(group, source);
    report[group] = r.ok ? { ok: true } : { ok: false, problems: r.problems };
  }
  return report;
}

/**
 * NEXT_PUBLIC_ variables are inlined into the browser bundle. Returns any whose name suggests a
 * secret so start-up can flag the mistake loudly.
 */
export function findExposedPublicSecrets(source: EnvSource = process.env): string[] {
  return Object.keys(source).filter(
    (k) => k.startsWith("NEXT_PUBLIC_") && /SECRET|TOKEN|PASSWORD|PRIVATE|MONGODB|API_KEY|JWT/i.test(k),
  );
}

/** Tests only: forget validated values so a changed process.env is re-read. */
export function resetEnvCache() {
  cache.clear();
}
