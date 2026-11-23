import "server-only";
import { Schema } from "mongoose";
import { baseOptions, defineModel } from "./_shared";

/**
 * One refresh-token session (a signed-in device) for a customer or an admin.
 *
 * Only a hash of the refresh token is stored. Every refresh rotates the token: the old hash moves
 * to `previousTokenHashes`; if a previous token is ever presented again, the whole `familyId` is
 * revoked (token reuse = likely theft).
 */
const SessionSchema = new Schema(
  {
    subjectType: { type: String, enum: ["user", "admin"], required: true },
    subject: { type: Schema.Types.ObjectId, required: true, refPath: "subjectModel" },
    subjectModel: { type: String, enum: ["User", "Admin"], required: true },
    familyId: { type: String, required: true },
    refreshTokenHash: { type: String, required: true },
    previousTokenHashes: { type: [String], default: [], select: false },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, enum: ["logout", "logout_all", "reuse_detected", "password_changed", "admin", null], default: null },
    lastUsedAt: { type: Date, default: () => new Date() },
    userAgent: { type: String, maxlength: 400, default: "" },
    ip: { type: String, maxlength: 64, default: "" },
  },
  baseOptions,
);

SessionSchema.index({ refreshTokenHash: 1 }, { unique: true });
SessionSchema.index({ previousTokenHashes: 1 });
SessionSchema.index({ subjectType: 1, subject: 1, revokedAt: 1 });
SessionSchema.index({ familyId: 1 });
// MongoDB deletes expired sessions automatically.
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = defineModel("Session", SessionSchema, "sessions");
