import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import type { Types } from "mongoose";
import type { z } from "zod";
import type { User as StoreUser } from "@/types";
import { ACCESS_TOKEN_TTL_SECONDS, signAccessToken } from "@/server/auth/jwt";
import { burnPasswordCheck, hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession, revokeAllSessions, revokeSession, rotateSession, type SessionMeta } from "@/server/auth/session.service";
import { getEnv } from "@/server/config/env";
import { connectToDatabase } from "@/server/db/connect";
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from "@/server/http/errors";
import { sendEmail } from "@/server/integrations/email/resend";
import { passwordChangedEmail, passwordResetEmail, welcomeEmail } from "@/server/integrations/email/templates";
import { User } from "@/server/models/user.model";
import { logger } from "@/server/utils/logger";
import { normalizeMobile } from "@/lib/validation";
import type { profilePatchBody, registerBody } from "@/server/validation/customer-auth";

/** "Remember me" sessions last 30 days; otherwise a day at most (and cookies end with the browser). */
export const REMEMBER_TTL_SECONDS = 30 * 24 * 60 * 60;
export const SHORT_TTL_SECONDS = 24 * 60 * 60;
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;
export const RESET_TTL_MINUTES = 30;
/** One reset email per account per minute, whatever the request rate. */
const RESET_COOLDOWN_MS = 60_000;

const INVALID = "Incorrect email/mobile or password.";

/* ---------- Mapping ---------- */

interface UserLean {
  _id: Types.ObjectId;
  fullName: string;
  email: string;
  mobile?: string | null;
  status?: string;
  emailVerifiedAt?: Date | null;
  marketingOptIn?: boolean;
  createdAt?: Date;
  addresses?: {
    _id: Types.ObjectId;
    label?: string | null;
    fullName?: string | null;
    mobile?: string | null;
    isDefault?: boolean | null;
    address: { house: string; street: string; city: string; district: string; state: string; pincode: string };
  }[];
}

/** The customer as the storefront sees it. Default address first. Never includes secrets. */
export function toStoreUser(u: UserLean): StoreUser {
  const addresses = (u.addresses ?? [])
    .map((a) => ({
      id: a._id.toString(),
      label: a.label ?? "Home",
      fullName: a.fullName ?? undefined,
      mobile: a.mobile ?? undefined,
      isDefault: !!a.isDefault,
      ...a.address,
    }))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  return {
    id: u._id.toString(),
    fullName: u.fullName,
    email: u.email,
    mobile: u.mobile ?? "",
    addresses,
    emailVerified: !!u.emailVerifiedAt,
    marketingOptIn: !!u.marketingOptIn,
    createdAt: (u.createdAt ?? new Date()).toISOString(),
  };
}

export interface IssuedCustomerSession {
  user: StoreUser;
  accessToken: string;
  accessMaxAge: number;
  refreshToken: string;
  /** undefined → browser-session cookies (no "Remember me"). */
  refreshMaxAge: number | undefined;
}

async function issue(userId: Types.ObjectId | string, remember: boolean, meta: SessionMeta) {
  const { session, refreshToken } = await createSession("user", userId, remember ? REMEMBER_TTL_SECONDS : SHORT_TTL_SECONDS, meta, {
    persistent: remember,
  });
  const accessToken = await signAccessToken({ sub: userId.toString(), sid: session._id.toString(), aud: "customer" });
  return { accessToken, refreshToken, accessMaxAge: ACCESS_TOKEN_TTL_SECONDS, refreshMaxAge: remember ? REMEMBER_TTL_SECONDS : undefined };
}

function appUrl(origin?: string) {
  return (process.env.NEXT_PUBLIC_APP_URL || origin || "http://localhost:3000").replace(/\/$/, "");
}

/* ---------- Registration & login ---------- */

export async function registerCustomer(body: z.output<typeof registerBody>, meta: SessionMeta & { origin?: string }): Promise<IssuedCustomerSession> {
  getEnv("auth");
  await connectToDatabase();
  const [emailTaken, mobileTaken] = await Promise.all([User.exists({ email: body.email }), User.exists({ mobile: body.mobile })]);
  // Registration necessarily reveals that an email/mobile is in use; rate limiting keeps that slow.
  if (emailTaken) throw conflict("An account with this email already exists. Try logging in instead.");
  if (mobileTaken) throw conflict("An account with this mobile number already exists. Try logging in instead.");

  let user;
  try {
    user = await User.create({
      fullName: body.fullName,
      email: body.email,
      mobile: body.mobile,
      passwordHash: await hashPassword(body.password),
      marketingOptIn: body.marketingOptIn,
      lastLoginAt: new Date(),
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw conflict("An account with these details already exists. Try logging in instead.");
    throw err;
  }

  const tokens = await issue(user._id, true, meta);
  // A failed welcome email never fails registration (sendEmail never throws).
  await sendEmail({ to: user.email, ...welcomeEmail(user.fullName, `${appUrl(meta.origin)}/shop`), idempotencyKey: `welcome-${user._id}` });
  return { user: toStoreUser(user.toObject() as UserLean), ...tokens };
}

/** `identifier` is an email address or a 10-digit Indian mobile number. */
export async function loginCustomer(identifier: string, password: string, remember: boolean, meta: SessionMeta): Promise<IssuedCustomerSession> {
  getEnv("auth");
  await connectToDatabase();
  const id = identifier.trim().toLowerCase();
  const query = id.includes("@") ? { email: id } : { mobile: normalizeMobile(id) };
  const user = await User.findOne(query).select("+passwordHash").lean<UserLean & { passwordHash: string; lockedUntil?: Date | null; failedLoginCount: number }>();

  if (!user) {
    await burnPasswordCheck(password);
    throw unauthorized(INVALID);
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw new AppError(423, "ACCOUNT_LOCKED", `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or reset your password.`);
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    const updated = await User.findOneAndUpdate({ _id: user._id }, { $inc: { failedLoginCount: 1 } }, { new: true }).lean();
    if (updated && updated.failedLoginCount >= MAX_FAILED_LOGINS) {
      await User.updateOne({ _id: user._id }, { $set: { lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000), failedLoginCount: 0 } });
    }
    throw unauthorized(INVALID);
  }
  // Only after the correct password, so this reveals nothing to someone guessing.
  if (user.status === "blocked") throw forbidden("This account has been suspended. Please contact us for help.");

  await User.updateOne({ _id: user._id }, { $set: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
  return { user: toStoreUser(user), ...(await issue(user._id, remember, meta)) };
}

export async function refreshCustomerSession(refreshToken: string | undefined): Promise<IssuedCustomerSession> {
  getEnv("auth");
  const rotated = await rotateSession(refreshToken, "user");
  if (!rotated.ok) {
    if (rotated.reason === "reused") logger.warn("auth.customer_refresh_reuse", {});
    throw new AppError(401, rotated.reason === "race" ? "TOKEN_EXPIRED" : "UNAUTHORIZED", "Your session has ended. Please log in again.");
  }
  const user = await User.findById(rotated.subject).lean<UserLean>();
  if (!user || user.status === "blocked") {
    await revokeSession(rotated.sessionId, "admin");
    throw unauthorized("Your session has ended. Please log in again.");
  }
  const accessToken = await signAccessToken({ sub: rotated.subject, sid: rotated.sessionId, aud: "customer" });
  const remaining = Math.max(0, Math.floor((rotated.expiresAt.getTime() - Date.now()) / 1000));
  return {
    user: toStoreUser(user),
    accessToken,
    accessMaxAge: ACCESS_TOKEN_TTL_SECONDS,
    refreshToken: rotated.refreshToken,
    refreshMaxAge: rotated.persistent ? remaining : undefined,
  };
}

/* ---------- Profile ---------- */

export async function getCustomer(userId: string) {
  await connectToDatabase();
  const user = await User.findById(userId).lean<UserLean>();
  if (!user) throw notFound("Account not found.");
  return toStoreUser(user);
}

export async function updateCustomerProfile(userId: string, patch: z.output<typeof profilePatchBody>) {
  await connectToDatabase();
  const user = await User.findById(userId).select("+passwordHash");
  if (!user) throw notFound("Account not found.");

  if (patch.email && patch.email !== user.email) {
    // Changing the email changes where password resets go — confirm it's really the owner.
    if (!patch.currentPassword || !(await verifyPassword(patch.currentPassword, user.passwordHash))) {
      throw badRequest("Enter your current password to change your email address.");
    }
    if (await User.exists({ email: patch.email, _id: { $ne: user._id } })) throw conflict("Another account already uses this email.");
    user.email = patch.email;
    user.emailVerifiedAt = null;
  }
  if (patch.mobile && patch.mobile !== user.mobile) {
    if (await User.exists({ mobile: patch.mobile, _id: { $ne: user._id } })) throw conflict("Another account already uses this mobile number.");
    user.mobile = patch.mobile;
  }
  if (patch.fullName) user.fullName = patch.fullName;
  if (patch.marketingOptIn !== undefined) user.marketingOptIn = patch.marketingOptIn;
  try {
    await user.save();
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw conflict("Another account already uses this email or mobile number.");
    throw err;
  }
  return toStoreUser(user.toObject() as UserLean);
}

export async function changeCustomerPassword(userId: string, sessionId: string, current: string, next: string) {
  await connectToDatabase();
  const user = await User.findById(userId).select("+passwordHash").lean<UserLean & { passwordHash: string }>();
  if (!user || !(await verifyPassword(current, user.passwordHash))) throw badRequest("Your current password is incorrect.");
  if (current === next) throw badRequest("Choose a password different from your current one.");
  await User.updateOne({ _id: userId }, { $set: { passwordHash: await hashPassword(next), passwordChangedAt: new Date() }, $unset: { passwordReset: 1 } });
  const others = await revokeAllSessions("user", userId, "password_changed", sessionId);
  await sendEmail({ to: user.email, ...passwordChangedEmail(user.fullName) });
  return others;
}

/* ---------- Forgot / reset password ---------- */

function hashResetToken(token: string) {
  // Separate key domain from refresh tokens.
  return createHmac("sha256", `reset:${getEnv("auth").JWT_REFRESH_SECRET}`).update(token).digest("base64url");
}

/**
 * Emails a single-use reset link if the account exists. Always behaves the same from the
 * outside (same response, similar timing), so it can't be used to discover accounts.
 */
export async function requestPasswordReset(email: string, origin?: string) {
  getEnv("auth");
  await connectToDatabase();
  const user = await User.findOne({ email }).select("+passwordReset").lean<UserLean & { passwordReset?: { requestedAt?: Date } | null }>();
  if (!user || user.status === "blocked") {
    await new Promise((r) => setTimeout(r, 150 + Math.random() * 150));
    return;
  }
  const last = user.passwordReset?.requestedAt?.getTime() ?? 0;
  if (Date.now() - last < RESET_COOLDOWN_MS) return;

  const token = randomBytes(32).toString("base64url");
  await User.updateOne(
    { _id: user._id },
    { $set: { passwordReset: { tokenHash: hashResetToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000), requestedAt: new Date() } } },
  );
  const url = `${appUrl(origin)}/reset-password?token=${token}`;
  const result = await sendEmail({ to: user.email, ...passwordResetEmail(user.fullName, url, RESET_TTL_MINUTES) });
  if (!result.sent && process.env.NODE_ENV === "development") {
    // Local development without Resend: show the link in the server console only.
    console.info(`\n[dev] Password reset link for ${user.email}:\n${url}\n`);
  }
}

/** Consumes the token atomically (single use), sets the new password and signs out everywhere. */
export async function resetPassword(token: string, password: string) {
  getEnv("auth");
  await connectToDatabase();
  const passwordHash = await hashPassword(password);
  const user = await User.findOneAndUpdate(
    { "passwordReset.tokenHash": hashResetToken(token), "passwordReset.expiresAt": { $gt: new Date() } },
    { $set: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null }, $unset: { passwordReset: 1 } },
    { new: true },
  ).lean<UserLean>();
  if (!user) throw badRequest("This reset link is invalid or has expired. Please request a new one.");
  await revokeAllSessions("user", user._id.toString(), "password_changed");
  await sendEmail({ to: user.email, ...passwordChangedEmail(user.fullName) });
}
