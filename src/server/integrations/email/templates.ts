import "server-only";

/** Transactional email templates: simple, inline-styled HTML plus a plain-text version. */

const BRAND = "M&M COLLECTIONS";

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#f7f3ee;font-family:Arial,Helvetica,sans-serif;color:#1f1f1f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:32px">
<tr><td style="font-size:20px;font-weight:bold;letter-spacing:1px;color:#2a0f11;padding-bottom:20px">M&amp;M COLLECTIONS</td></tr>
<tr><td style="font-size:18px;font-weight:bold;padding-bottom:12px">${escape(title)}</td></tr>
<tr><td style="font-size:15px;line-height:24px">${body}</td></tr>
</table>
<p style="font-size:12px;color:#8a8a8a;margin-top:16px">You received this email because of activity on your ${BRAND} account.</p>
</td></tr></table></body></html>`;
}

const button = (href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${escape(href)}" style="background:#b3121b;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:bold;display:inline-block">${escape(label)}</a></p>`;

export function passwordResetEmail(name: string, url: string, minutes: number) {
  const first = name.split(" ")[0] || "there";
  return {
    subject: `Reset your ${BRAND} password`,
    html: layout(
      "Reset your password",
      `<p>Hi ${escape(first)},</p><p>We received a request to reset your password. This link works once and expires in ${minutes} minutes.</p>${button(url, "Choose a new password")}<p style="font-size:13px;color:#6b6b6b">If you didn't ask for this, you can ignore this email — your password won't change.</p>`,
    ),
    text: `Hi ${first},\n\nReset your ${BRAND} password using this link (valid once, for ${minutes} minutes):\n${url}\n\nIf you didn't ask for this, ignore this email.`,
  };
}

export function welcomeEmail(name: string, shopUrl: string) {
  const first = name.split(" ")[0] || "there";
  return {
    subject: `Welcome to ${BRAND}`,
    html: layout(
      `Welcome, ${first}!`,
      `<p>Your account is ready. Save addresses for faster checkout, keep a wishlist and track your orders in one place.</p>${button(shopUrl, "Start shopping")}`,
    ),
    text: `Welcome to ${BRAND}, ${first}!\n\nYour account is ready. Start shopping: ${shopUrl}`,
  };
}

export function passwordChangedEmail(name: string) {
  const first = name.split(" ")[0] || "there";
  return {
    subject: `Your ${BRAND} password was changed`,
    html: layout(
      "Your password was changed",
      `<p>Hi ${escape(first)},</p><p>The password for your account was just changed and other devices were signed out.</p><p style="font-size:13px;color:#6b6b6b">If this wasn't you, reset your password straight away and contact us.</p>`,
    ),
    text: `Hi ${first},\n\nThe password for your ${BRAND} account was just changed and other devices were signed out. If this wasn't you, reset your password straight away and contact us.`,
  };
}
