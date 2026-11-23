import "server-only";

type Level = "debug" | "info" | "warn" | "error";
type Meta = Record<string, unknown>;

/** Keys whose values must never reach the logs, even if a caller passes them by mistake. */
const REDACT = /pass(word)?|secret|token|authorization|cookie|signature|api[-_]?key|otp/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = REDACT.test(k) ? "[redacted]" : redact(v, depth + 1);
  return out;
}

export function serializeError(err: unknown): Meta {
  if (!(err instanceof Error)) return { value: String(err) };
  const e = err as Error & { code?: unknown; codeName?: unknown };
  return {
    name: e.name,
    message: e.message,
    ...(e.code !== undefined && { code: e.code }),
    ...(e.codeName !== undefined && { codeName: e.codeName }),
    ...(process.env.NODE_ENV !== "production" && { stack: e.stack }),
    ...(e.cause !== undefined && { cause: serializeError(e.cause) }),
  };
}

function write(level: Level, event: string, meta?: Meta) {
  if (level === "debug" && process.env.NODE_ENV === "production") return;
  // One JSON object per line — Vercel's log drains index these fields.
  const line = JSON.stringify({ level, event, time: new Date().toISOString(), ...(redact(meta) as Meta) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, meta?: Meta) => write("debug", event, meta),
  info: (event: string, meta?: Meta) => write("info", event, meta),
  warn: (event: string, meta?: Meta) => write("warn", event, meta),
  error: (event: string, meta?: Meta) => write("error", event, meta),
};
