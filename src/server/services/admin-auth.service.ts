import "server-only";
import { Types } from "mongoose";
import { PERMISSIONS, type Permission } from "@/server/auth/permissions";
import { ACCESS_TOKEN_TTL_SECONDS, signAccessToken } from "@/server/auth/jwt";
import { burnPasswordCheck, hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession, revokeAllSessions, revokeSession, rotateSession, type SessionMeta } from "@/server/auth/session.service";
import { getEnv } from "@/server/config/env";
import { connectToDatabase } from "@/server/db/connect";
import { AppError, badRequest, unauthorized } from "@/server/http/errors";
import { Admin } from "@/server/models/admin.model";
import { Role } from "@/server/models/role.model";
import { audit } from "./audit.service";

/** Admin sessions last at most 7 days, then a fresh sign-in is required. */
export const ADMIN_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const INVALID = "Incorrect username/email or password.";

export interface AdminProfile {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
  role: { key: string; name: string };
  permissions: Permission[];
}

interface RoleLean {
  key: string;
  name: string;
  permissions: string[];
}

/** Owner always holds every permission, even ones added after the role was created. */
export function permissionsFor(role: RoleLean | null | undefined): Permission[] {
  if (!role) return [];
  if (role.key === "owner") return [...PERMISSIONS];
  return role.permissions.filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p));
}

export function toProfile(
  admin: { _id: Types.ObjectId; name: string; email?: string | null; username?: string | null },
  role: RoleLean | null,
): AdminProfile {
  return {
    id: admin._id.toString(),
    name: admin.name,
    username: admin.username ?? null,
    email: admin.email ?? null,
    role: { key: role?.key ?? "", name: role?.name ?? "" },
    permissions: permissionsFor(role),
  };
}

async function issueTokens(adminId: string, sessionId: string) {
  return signAccessToken({ sub: adminId, sid: sessionId, aud: "admin" });
}

export interface IssuedSession {
  profile: AdminProfile;
  accessToken: string;
  accessMaxAge: number;
  refreshToken: string;
  refreshMaxAge: number;
}

/** Counted for visibility only. The same write whether or not the account exists, so timing says less. */
const countFailure = (adminId?: Types.ObjectId) => Admin.updateOne({ _id: adminId ?? new Types.ObjectId() }, { $inc: { failedLoginCount: 1 } });

/**
 * `identifier` is a username or an email address. Brute-force limits are applied by the caller
 * (security/admin-login-limit) before this runs; accounts are never locked here, so a correct
 * password is never refused because of other people's guesses.
 */
export async function loginAdmin(identifier: string, password: string, meta: SessionMeta): Promise<IssuedSession> {
  getEnv("auth"); // fail fast (503) if JWT secrets are missing
  await connectToDatabase();
  const normalized = identifier.trim().toLowerCase();
  const admin = await Admin.findOne({ $or: [{ username: normalized }, { email: normalized }] }).select("+passwordHash").lean();

  if (!admin) {
    await burnPasswordCheck(password);
    await countFailure();
    await audit({ name: "unknown", email: normalized, ...meta }, "admin.login_failed", { type: "admin", label: normalized }, { reason: "unknown_email" });
    throw unauthorized(INVALID);
  }

  const passwordOk = await verifyPassword(password, admin.passwordHash);
  if (!passwordOk || admin.status !== "active") {
    await countFailure(admin._id);
    await audit(
      { adminId: admin._id.toString(), name: admin.name, email: admin.email ?? admin.username, ...meta },
      "admin.login_failed",
      { type: "admin", id: admin._id.toString(), label: admin.email ?? admin.username ?? undefined },
      { reason: passwordOk ? "disabled" : "wrong_password" },
    );
    throw unauthorized(INVALID);
  }

  const role = await Role.findById(admin.role).lean();
  await Admin.updateOne({ _id: admin._id }, { $set: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
  const { session, refreshToken } = await createSession("admin", admin._id, ADMIN_SESSION_TTL_SECONDS, meta);
  const accessToken = await issueTokens(admin._id.toString(), session._id.toString());
  const profile = toProfile(admin, role);
  await audit({ adminId: profile.id, name: profile.name, email: profile.email, role: profile.role.key, ...meta }, "admin.login", {
    type: "admin",
    id: profile.id,
    label: profile.email ?? profile.username ?? undefined,
  });

  return { profile, accessToken, accessMaxAge: ACCESS_TOKEN_TTL_SECONDS, refreshToken, refreshMaxAge: ADMIN_SESSION_TTL_SECONDS };
}

export async function refreshAdminSession(refreshToken: string | undefined, meta: SessionMeta): Promise<IssuedSession> {
  getEnv("auth");
  const rotated = await rotateSession(refreshToken, "admin");
  if (!rotated.ok) {
    if (rotated.reason === "reused") {
      await audit({ name: "unknown", ...meta }, "admin.refresh_token_reuse", { type: "session" });
    }
    // "race": another tab already refreshed; the browser now holds the new cookie, so a retry works.
    throw new AppError(401, rotated.reason === "race" ? "TOKEN_EXPIRED" : "UNAUTHORIZED", "Your session has ended. Please sign in again.");
  }

  const admin = await Admin.findById(rotated.subject).lean();
  if (!admin || admin.status !== "active") {
    await revokeSession(rotated.sessionId, "admin");
    throw unauthorized("Your session has ended. Please sign in again.");
  }
  const role = await Role.findById(admin.role).lean();
  const accessToken = await issueTokens(rotated.subject, rotated.sessionId);
  const refreshMaxAge = Math.max(0, Math.floor((rotated.expiresAt.getTime() - Date.now()) / 1000));
  return { profile: toProfile(admin, role), accessToken, accessMaxAge: ACCESS_TOKEN_TTL_SECONDS, refreshToken: rotated.refreshToken, refreshMaxAge };
}

export async function changeAdminPassword(adminId: string, currentSessionId: string, current: string, next: string) {
  await connectToDatabase();
  const admin = await Admin.findById(adminId).select("+passwordHash").lean();
  if (!admin || !(await verifyPassword(current, admin.passwordHash))) throw badRequest("Your current password is incorrect.");
  if (current === next) throw badRequest("Choose a password you haven't used here.");
  await Admin.updateOne({ _id: adminId }, { $set: { passwordHash: await hashPassword(next), passwordChangedAt: new Date() } });
  // Every other device must sign in again with the new password.
  return revokeAllSessions("admin", adminId, "password_changed", currentSessionId);
}
