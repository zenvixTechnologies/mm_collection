import "server-only";
import { randomUUID } from "node:crypto";
import type { Types } from "mongoose";
import { connectToDatabase } from "@/server/db/connect";
import { Session } from "@/server/models/session.model";
import { generateRefreshToken, hashRefreshToken } from "./refresh-token";

export type SubjectType = "user" | "admin";
type RevokeReason = "logout" | "logout_all" | "reuse_detected" | "password_changed" | "admin";

/** Two tabs refreshing at the same moment is a race, not theft. */
const RACE_WINDOW_MS = 10_000;
const MAX_PREVIOUS_HASHES = 20;

const MODEL: Record<SubjectType, "User" | "Admin"> = { user: "User", admin: "Admin" };

export interface SessionMeta {
  userAgent?: string;
  ip?: string;
}

export async function createSession(subjectType: SubjectType, subject: Types.ObjectId | string, ttlSeconds: number, meta: SessionMeta = {}) {
  await connectToDatabase();
  const refreshToken = generateRefreshToken();
  const session = await Session.create({
    subjectType,
    subject,
    subjectModel: MODEL[subjectType],
    familyId: randomUUID(),
    refreshTokenHash: hashRefreshToken(refreshToken),
    expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    userAgent: (meta.userAgent ?? "").slice(0, 400),
    ip: (meta.ip ?? "").slice(0, 64),
  });
  return { session, refreshToken };
}

export type RotateResult =
  | { ok: true; sessionId: string; subject: string; subjectType: SubjectType; refreshToken: string; expiresAt: Date }
  | { ok: false; reason: "invalid" | "reused" | "race" };

/**
 * Exchanges a refresh token for a new one (rotation). The swap is a single atomic update, so the
 * same token can never be redeemed twice. Presenting an already-rotated token outside the race
 * window means it was copied: the whole session family is revoked.
 */
export async function rotateSession(refreshToken: string | undefined, subjectType: SubjectType): Promise<RotateResult> {
  if (!refreshToken || refreshToken.length > 200) return { ok: false, reason: "invalid" };
  await connectToDatabase();
  const hash = hashRefreshToken(refreshToken);
  const next = generateRefreshToken();
  const now = new Date();

  const session = await Session.findOneAndUpdate(
    { refreshTokenHash: hash, subjectType, revokedAt: null, expiresAt: { $gt: now } },
    {
      $set: { refreshTokenHash: hashRefreshToken(next), lastUsedAt: now },
      $push: { previousTokenHashes: { $each: [hash], $slice: -MAX_PREVIOUS_HASHES } },
    },
    { new: true },
  ).lean();

  if (session) {
    return {
      ok: true,
      sessionId: session._id.toString(),
      subject: session.subject.toString(),
      subjectType,
      refreshToken: next,
      expiresAt: session.expiresAt,
    };
  }

  const reused = await Session.findOne({ previousTokenHashes: hash, subjectType }).lean();
  if (!reused) return { ok: false, reason: "invalid" };
  if (!reused.revokedAt && now.getTime() - new Date(reused.lastUsedAt ?? 0).getTime() < RACE_WINDOW_MS) {
    return { ok: false, reason: "race" };
  }
  await Session.updateMany({ familyId: reused.familyId, revokedAt: null }, { $set: { revokedAt: now, revokedReason: "reuse_detected" } });
  return { ok: false, reason: "reused" };
}

/** The session behind an access token, if it is still valid. */
export async function getActiveSession(sessionId: string, subjectType: SubjectType, subject: string) {
  await connectToDatabase();
  return Session.findOne({ _id: sessionId, subjectType, subject, revokedAt: null, expiresAt: { $gt: new Date() } }).lean();
}

export async function revokeSession(sessionId: string, reason: RevokeReason) {
  await connectToDatabase();
  await Session.updateOne({ _id: sessionId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } });
}

/** Signs a subject out everywhere, optionally keeping the current session. */
export async function revokeAllSessions(subjectType: SubjectType, subject: string, reason: RevokeReason, exceptSessionId?: string) {
  await connectToDatabase();
  const res = await Session.updateMany(
    { subjectType, subject, revokedAt: null, ...(exceptSessionId && { _id: { $ne: exceptSessionId } }) },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
  return res.modifiedCount;
}

export async function listActiveSessions(subjectType: SubjectType, subject: string) {
  await connectToDatabase();
  return Session.find(
    { subjectType, subject, revokedAt: null, expiresAt: { $gt: new Date() } },
    { userAgent: 1, ip: 1, createdAt: 1, lastUsedAt: 1, expiresAt: 1 },
  )
    .sort({ lastUsedAt: -1 })
    .lean();
}
