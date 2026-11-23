import "server-only";
import { connectToDatabase } from "@/server/db/connect";
import { AuditLog } from "@/server/models/audit-log.model";
import { logger, serializeError } from "@/server/utils/logger";

export interface AuditActor {
  adminId?: string | null;
  name?: string;
  email?: string | null;
  role?: string | null;
  ip?: string;
  userAgent?: string;
}

/**
 * Records an admin action. Never throws: a failed audit write is logged but must not undo or
 * block the action itself. Callers must not pass secrets or password hashes in `changes`.
 */
export async function audit(
  actor: AuditActor,
  action: string,
  entity: { type: string; id?: string; label?: string } | null = null,
  changes: unknown = null,
) {
  try {
    await connectToDatabase();
    await AuditLog.create({
      actor: { admin: actor.adminId ?? null, name: actor.name ?? "system", email: actor.email ?? null, role: actor.role ?? null },
      action,
      entity,
      changes,
      ip: (actor.ip ?? "").slice(0, 64),
      userAgent: (actor.userAgent ?? "").slice(0, 400),
    });
  } catch (err) {
    logger.error("audit.write_failed", { action, error: serializeError(err) });
  }
}
