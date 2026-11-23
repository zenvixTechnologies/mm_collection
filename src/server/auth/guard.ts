import "server-only";
import type { NextRequest } from "next/server";
import { connectToDatabase } from "@/server/db/connect";
import { AppError, forbidden } from "@/server/http/errors";
import { clientIp, isSameOrigin, userAgent } from "@/server/http/request-info";
import { Admin } from "@/server/models/admin.model";
import { Role } from "@/server/models/role.model";
import { toProfile, type AdminProfile } from "@/server/services/admin-auth.service";
import type { AuditActor } from "@/server/services/audit.service";
import { ADMIN_ACCESS_COOKIE } from "./cookies";
import { verifyAccessToken } from "./jwt";
import type { Permission } from "./permissions";
import { getActiveSession } from "./session.service";

export interface AdminContext {
  admin: AdminProfile;
  sessionId: string;
  /** Ready-made actor for audit() calls. */
  actor: AuditActor;
  can: (permission: Permission) => boolean;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Authenticates and authorises an admin request. Call it first in every admin route handler.
 *
 * Checks, in order: same-origin (for state-changing methods) → access token signature/expiry →
 * session still active in MongoDB (so logout/revocation is immediate) → admin still active →
 * the role (re-read from MongoDB, never from the token) grants every required permission.
 */
export async function requireAdmin(req: NextRequest, ...required: Permission[]): Promise<AdminContext> {
  if (!SAFE_METHODS.has(req.method) && !isSameOrigin(req)) {
    throw forbidden("This request was blocked for your security. Please reload the page and try again.");
  }

  const verified = await verifyAccessToken(req.cookies.get(ADMIN_ACCESS_COOKIE)?.value, "admin");
  if (!verified.ok) {
    throw verified.reason === "expired"
      ? new AppError(401, "TOKEN_EXPIRED", "Your session needs refreshing.")
      : new AppError(401, "UNAUTHORIZED", "Please sign in to continue.");
  }
  const { sub, sid } = verified.claims;

  await connectToDatabase();

  const [session, admin] = await Promise.all([getActiveSession(sid, "admin", sub), Admin.findById(sub).lean()]);
  if (!session || !admin || admin.status !== "active") throw new AppError(401, "UNAUTHORIZED", "Please sign in to continue.");

  const role = await Role.findById(admin.role).lean();
  const profile = toProfile(admin, role);
  const granted = new Set(profile.permissions);
  const missing = required.filter((p) => !granted.has(p));
  if (missing.length) throw forbidden("You don't have permission to do that.");

  return {
    admin: profile,
    sessionId: sid,
    actor: { adminId: profile.id, name: profile.name, email: profile.email, role: profile.role.key, ip: clientIp(req), userAgent: userAgent(req) },
    can: (p) => granted.has(p),
  };
}
