import "server-only";

/** Client IP as seen by Vercel / a proxy. Used for audit logs and rate limiting only. */
export function clientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || req.headers.get("x-real-ip") || "").slice(0, 64);
}

export function userAgent(req: Request) {
  return (req.headers.get("user-agent") ?? "").slice(0, 400);
}

/**
 * Cross-site request forgery check for state-changing requests: the browser-supplied Origin
 * must be this site. (Admin cookies are also SameSite=Strict — this is the second layer.)
 */
export function isSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const allowed = new Set<string>([new URL(req.url).origin]);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    try {
      allowed.add(new URL(appUrl).origin);
    } catch {
      /* ignore malformed */
    }
  }
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  if (host) allowed.add(`${proto}://${host}`);
  return allowed.has(origin);
}
