/**
 * Runs once when a Next.js server instance starts. Reports which backend integrations are
 * configured (variable names only, never values) and flags secrets placed in NEXT_PUBLIC_ vars.
 * Missing integrations don't stop the server — the endpoints that need them return 503.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { envReport, findExposedPublicSecrets } = await import("@/server/config/env");
  const { logger } = await import("@/server/utils/logger");

  const exposed = findExposedPublicSecrets();
  if (exposed.length) {
    logger.error("env.public_secret", {
      variables: exposed,
      hint: "NEXT_PUBLIC_ variables are sent to the browser. Rename them without the prefix.",
    });
  }

  const report = envReport();
  const missing = Object.entries(report).filter(([, r]) => !r.ok);
  if (missing.length) {
    logger.warn("env.integrations_not_configured", {
      integrations: Object.fromEntries(missing.map(([group, r]) => [group, "problems" in r ? r.problems : []])),
    });
  }
}
