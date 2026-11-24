import "server-only";
import { Schema } from "mongoose";
import { AddressSchema, AUDIENCES, baseOptions, defineModel } from "./_shared";

const SavedAddressSchema = new Schema(
  {
    label: { type: String, trim: true, maxlength: 40, default: "Home" },
    fullName: { type: String, trim: true, maxlength: 120 },
    mobile: { type: String, match: /^[6-9]\d{9}$/ },
    address: { type: AddressSchema, required: true },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: false },
);

/** Customer account. Guests check out without one; their orders carry contact details instead. */
const UserSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    mobile: { type: String, match: /^[6-9]\d{9}$/ },
    passwordHash: { type: String, required: true, select: false },
    emailVerifiedAt: { type: Date, default: null },
    status: { type: String, enum: ["active", "blocked"], default: "active" },
    addresses: { type: [SavedAddressSchema], default: [] },
    marketingOptIn: { type: Boolean, default: false },
    primaryAudience: { type: String, enum: AUDIENCES, default: null },
    /** Staff-only notes, shown in the admin customer view. */
    adminNotes: { type: String, trim: true, maxlength: 2000, default: "" },
    failedLoginCount: { type: Number, default: 0, min: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
    /** Only a SHA-256 hash of the reset token is stored. */
    passwordReset: {
      type: new Schema({ tokenHash: String, expiresAt: Date, requestedAt: Date }, { _id: false }),
      default: null,
      select: false,
    },
  },
  baseOptions,
);

UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ mobile: 1 }, { unique: true, partialFilterExpression: { mobile: { $type: "string" } } });
UserSchema.index({ "passwordReset.tokenHash": 1 }, { partialFilterExpression: { "passwordReset.tokenHash": { $type: "string" } } });
UserSchema.index({ createdAt: -1 });
UserSchema.index({ status: 1, createdAt: -1 });

export const User = defineModel("User", UserSchema, "users");
