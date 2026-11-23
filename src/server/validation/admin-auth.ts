import "server-only";
import { z } from "zod";
import { passwordSchema } from "@/server/auth/password";
import { objectId } from "./common";

/** Admin username rule (stored lower-case). */
export const adminUsername = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._@&-]{3,40}$/, "Use 3–40 letters, numbers or . _ - @ &.");

export const adminLoginBody = z.object({
  /** Username or email address. */
  identifier: z.string().trim().toLowerCase().min(1, "Enter your username or email.").max(254),
  // Login only checks length bounds; strength rules apply when a password is set.
  password: z.string().min(1, "Enter your password.").max(200),
});

export const changePasswordBody = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

export const sessionIdParams = z.object({ id: objectId });
