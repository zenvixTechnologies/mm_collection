import "server-only";
import { z } from "zod";
import { address, email, indianMobile, objectId } from "./common";

/** Customer passwords: 8+ characters with a letter and a number (bcrypt reads at most 72 bytes). */
export const customerPassword = z
  .string()
  .min(8, "Use at least 8 characters.")
  .refine((p) => Buffer.byteLength(p, "utf8") <= 72, "Use at most 72 characters.")
  .refine((p) => /[a-z]/i.test(p) && /\d/.test(p), "Include at least one letter and one number.");

const fullName = z
  .string()
  .trim()
  .min(3, "Please enter your full name.")
  .max(120)
  .regex(/^[\p{L} .'-]+$/u, "Name can only contain letters and spaces.");

export const registerBody = z.object({
  fullName,
  email,
  mobile: indianMobile,
  password: customerPassword,
  marketingOptIn: z.boolean().default(false),
});

export const customerLoginBody = z.object({
  /** Email address or 10-digit mobile number. */
  identifier: z.string().trim().min(1, "Enter your email or mobile number.").max(254),
  password: z.string().min(1, "Enter your password.").max(200),
  remember: z.boolean().default(true),
});

export const profilePatchBody = z
  .object({
    fullName: fullName.optional(),
    email: email.optional(),
    mobile: indianMobile.optional(),
    marketingOptIn: z.boolean().optional(),
    /** Required when changing the email address. */
    currentPassword: z.string().min(1).max(200).optional(),
  })
  .refine((b) => Object.keys(b).some((k) => k !== "currentPassword"), "Nothing to update.");

export const customerChangePasswordBody = z.object({
  currentPassword: z.string().min(1, "Enter your current password.").max(200),
  newPassword: customerPassword,
});

export const forgotPasswordBody = z.object({ email });

export const resetPasswordBody = z.object({
  token: z.string().trim().min(20).max(200).regex(/^[A-Za-z0-9_-]+$/, "This reset link is invalid."),
  password: customerPassword,
});

export const addressBody = address.extend({
  label: z.string().trim().max(40).optional(),
  fullName: fullName.optional(),
  mobile: indianMobile.optional(),
  isDefault: z.boolean().optional(),
});

export const addressIdParams = z.object({ id: objectId });
