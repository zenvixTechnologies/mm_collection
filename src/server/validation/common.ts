import "server-only";
import { z } from "zod";
import { INDIAN_STATES, PIN_RE, normalizeMobile } from "@/lib/validation";

/**
 * Reusable Zod building blocks for request validation. Indian address rules come from
 * src/lib/validation.ts so the server and the checkout form can never disagree.
 */

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid identifier.");

export const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens only.");

export const email = z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address."));

export const indianMobile = z
  .string()
  .trim()
  .max(20)
  .transform(normalizeMobile)
  .pipe(z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number."));

export const pincode = z.string().trim().regex(PIN_RE, "Enter a valid 6-digit PIN code.");

export const indianState = z
  .string()
  .trim()
  .refine((s) => INDIAN_STATES.includes(s), "We currently deliver within India only — please pick an Indian state.");

export const address = z.object({
  house: z.string().trim().min(1, "House / building is required.").max(200),
  street: z.string().trim().min(1, "Street / area is required.").max(200),
  city: z.string().trim().min(1, "City is required.").max(100),
  district: z.string().trim().min(1, "District is required.").max(100),
  state: indianState,
  pincode,
  country: z
    .string()
    .trim()
    .optional()
    .refine((c) => c === undefined || /^(india|in)$/i.test(c), "We currently deliver within India only.")
    .transform(() => "India" as const),
});

/** Money is always integer paise (₹1 = 100 paise) — never floating-point rupees. */
export const paise = z.number().int("Amount must be in whole paise.").min(0).max(Number.MAX_SAFE_INTEGER);

/** Query-string boolean: "true"/"1" → true, "false"/"0" → false. */
export const queryBoolean = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

export const MAX_PAGE_SIZE = 100;

export const pagination = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

export type Pagination = z.output<typeof pagination>;

export const skipFor = ({ page, limit }: Pagination) => (page - 1) * limit;
