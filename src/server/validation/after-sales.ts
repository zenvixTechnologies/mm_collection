import "server-only";
import { z } from "zod";
import { CANCEL_REASON_KEYS, RETURN_REASON_KEYS, RETURN_STATUS_KEYS } from "@/lib/after-sales";
import { objectId, pagination } from "./common";

const optionalText = (max: number) => z.string().trim().max(max, `Keep this under ${max} characters.`).default("");
const confirmed = z.literal(true, { error: "Please confirm before submitting." });

/** Unknown fields (customer, status, amounts…) are dropped: the server decides all of those. */
export const cancelOrderBody = z
  .object({
    reason: z.enum(CANCEL_REASON_KEYS, { error: "Choose why you're cancelling." }),
    otherReason: optionalText(500),
    details: optionalText(1000),
    confirm: confirmed,
  })
  .refine((b) => b.reason !== "other" || b.otherReason.length >= 3, { path: ["otherReason"], message: "Please tell us your reason." });

export const returnRequestBody = z
  .object({
    itemId: objectId,
    quantity: z.number().int("Choose a whole quantity.").min(1, "Choose at least 1.").max(20),
    reason: z.enum(RETURN_REASON_KEYS, { error: "Choose a return reason." }),
    explanation: optionalText(1000),
    comments: optionalText(1000),
    confirm: confirmed,
  })
  .refine((b) => b.reason !== "other" || b.explanation.length >= 3, { path: ["explanation"], message: "Please explain your reason." });

export const returnListQuery = pagination.extend({
  status: z.enum(RETURN_STATUS_KEYS).optional(),
  order: z.string().trim().toUpperCase().regex(/^MM[A-Z0-9]{4,12}$/, "Invalid order number.").optional(),
});

export const cancellationListQuery = pagination;
export const returnParams = z.object({ id: objectId });
export const returnStatusBody = z.object({ status: z.enum(RETURN_STATUS_KEYS), note: optionalText(2000) });
export const returnNoteBody = z.object({ text: z.string().trim().min(1, "Write a note first.").max(2000) });
