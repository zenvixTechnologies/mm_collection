import "server-only";
import { Schema } from "mongoose";
import { baseOptions, defineModel } from "./_shared";

/** Staff account for the /mm-hub admin panel. Kept separate from customer users. */
const AdminSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    /** Sign-in name, case-insensitive. Letters, numbers and . _ - @ & (3–40 characters). */
    username: { type: String, trim: true, lowercase: true, match: /^[a-z0-9._@&-]{3,40}$/, default: undefined },
    /** Optional; needed for password-reset emails. */
    email: { type: String, trim: true, lowercase: true, maxlength: 254, default: undefined },
    /** bcrypt hash — never selected unless explicitly requested. */
    passwordHash: { type: String, required: true, select: false },
    role: { type: Schema.Types.ObjectId, ref: "Role", required: true },
    status: { type: String, enum: ["active", "disabled"], default: "active" },
    failedLoginCount: { type: Number, default: 0, min: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
  },
  baseOptions,
);

AdminSchema.pre("validate", function (this: { username?: string | null; email?: string | null; invalidate: (p: string, m: string) => void }) {
  if (!this.username && !this.email) this.invalidate("username", "An admin needs a username or an email address.");
});

AdminSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: "string" } } });
AdminSchema.index({ username: 1 }, { unique: true, partialFilterExpression: { username: { $type: "string" } } });
AdminSchema.index({ role: 1 });

export const Admin = defineModel("Admin", AdminSchema, "admins");
