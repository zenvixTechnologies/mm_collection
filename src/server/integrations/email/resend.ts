import "server-only";
import { getEnv, isConfigured } from "@/server/config/env";
import { logger, serializeError } from "@/server/utils/logger";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Groups retries of the same logical email so Resend sends it only once. */
  idempotencyKey?: string;
}

export type SendResult = { sent: true; id: string } | { sent: false; reason: "not_configured" | "failed" };

/**
 * Sends a transactional email through Resend's REST API. Never throws: a failed email must not
 * fail the action that triggered it (a password reset request, an order, a payment).
 */
export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  if (!isConfigured("email")) {
    logger.warn("email.not_configured", { subject: msg.subject, hint: "Set RESEND_API_KEY and EMAIL_FROM to send emails." });
    return { sent: false, reason: "not_configured" };
  }
  const { RESEND_API_KEY, EMAIL_FROM } = getEnv("email");
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
        ...(msg.idempotencyKey && { "Idempotency-Key": msg.idempotencyKey }),
      },
      body: JSON.stringify({ from: EMAIL_FROM, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok || !body.id) throw new Error(`Resend ${res.status}: ${body.message ?? "unknown error"}`);
    return { sent: true, id: body.id };
  } catch (err) {
    logger.error("email.send_failed", { subject: msg.subject, error: serializeError(err) });
    return { sent: false, reason: "failed" };
  }
}
