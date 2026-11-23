import "server-only";
import { Schema } from "mongoose";
import { baseOptions, defineModel } from "./_shared";

/** Record of an important admin action. Written by services; never edited. */
const AuditLogSchema = new Schema(
  {
    actor: {
      admin: { type: Schema.Types.ObjectId, ref: "Admin", default: null },
      name: { type: String, default: "system" },
      email: { type: String, default: null },
      role: { type: String, default: null },
    },
    /** e.g. "product.update", "order.refund", "admin.login_failed" */
    action: { type: String, required: true, maxlength: 80 },
    entity: {
      type: { type: String, maxlength: 40 },
      id: { type: String, maxlength: 300 },
      label: { type: String, maxlength: 200 },
    },
    /** Changed fields (before/after). Services must not put secrets or password hashes here. */
    changes: { type: Schema.Types.Mixed, default: null },
    ip: { type: String, maxlength: 64, default: "" },
    userAgent: { type: String, maxlength: 400, default: "" },
  },
  { ...baseOptions, timestamps: { createdAt: true, updatedAt: false } },
);

AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ "actor.admin": 1, createdAt: -1 });
AuditLogSchema.index({ "entity.type": 1, "entity.id": 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });

export const AuditLog = defineModel("AuditLog", AuditLogSchema, "audit_logs");
