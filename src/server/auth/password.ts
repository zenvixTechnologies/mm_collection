import "server-only";
import bcrypt from "bcryptjs";
import { z } from "zod";

const COST = 12;

/**
 * Password rules. bcrypt only uses the first 72 bytes, so longer passwords are rejected rather
 * than silently truncated.
 */
export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters.")
  .refine((p) => Buffer.byteLength(p, "utf8") <= 72, "Use at most 72 characters.")
  .refine((p) => /[a-z]/i.test(p) && /\d/.test(p), "Include at least one letter and one number.");

export function hashPassword(plain: string) {
  return bcrypt.hash(plain, COST);
}

export function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

/**
 * Compared against when the email doesn't exist, so a wrong email takes as long as a wrong
 * password and response timing doesn't reveal which accounts exist.
 */
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(plain: string) {
  dummyHash ??= bcrypt.hash("not-a-real-password-0", COST);
  await bcrypt.compare(plain, await dummyHash);
}
