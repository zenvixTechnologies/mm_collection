import "server-only";
import { Schema } from "mongoose";
import { PERMISSIONS } from "@/server/auth/permissions";
import { baseOptions, defineModel } from "./_shared";

/** Admin role with a list of permissions. owner / manager / staff are seeded as system roles. */
const RoleSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true, match: /^[a-z][a-z0-9-]{1,39}$/ },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, trim: true, maxlength: 300, default: "" },
    permissions: { type: [{ type: String, enum: PERMISSIONS }], default: [] },
    /** System roles can't be deleted; the owner role's permissions can't be reduced. */
    isSystem: { type: Boolean, default: false },
  },
  baseOptions,
);

RoleSchema.index({ key: 1 }, { unique: true });

export const Role = defineModel("Role", RoleSchema, "roles");
