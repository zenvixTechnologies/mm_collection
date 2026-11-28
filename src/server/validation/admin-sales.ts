import "server-only";
import { z } from "zod";
import { objectId, pagination } from "./common";

/**
 * Admin customers, orders and payments requests. Search terms are length-limited here and
 * regex-escaped by the services before they reach MongoDB.
 */

const text = (max: number) => z.string().trim().max(max);
const search = text(100).optional().transform((v) => v || undefined);
const isoDate = z.coerce.date({ error: "Use a valid date." });

const listBase = pagination.extend({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: search,
  from: isoDate.optional(),
  to: isoDate.optional(),
  dir: z.enum(["asc", "desc"]).default("desc"),
});

/* ---------- Customers ---------- */

export const CUSTOMER_SEGMENTS = ["all", "new", "repeat", "vip", "blocked"] as const;

export const customerListQuery = listBase.extend({
  status: z.enum(["active", "blocked"]).optional(),
  segment: z.enum(CUSTOMER_SEGMENTS).default("all"),
  sort: z.enum(["joined", "name", "orders", "spent", "last"]).default("joined"),
});

export const customerParams = z.object({ id: objectId });

export const customerUpdateBody = z
  .object({
    status: z.enum(["active", "blocked"]).optional(),
    notes: text(2000).optional(),
  })
  .refine((b) => b.status !== undefined || b.notes !== undefined, "Nothing to update.");

/* ---------- Orders ---------- */

/** Storefront-facing status names the admin filters by. */
export const ADMIN_ORDER_STATUS = [
  "Payment Pending",
  "Order Placed",
  "Confirmed",
  "Processing",
  "Packed",
  "Shipped",
  "Out for Delivery",
  "Delivered",
  "Cancelled",
  "Payment Failed",
  "Expired",
] as const;

export const ORDER_PAYMENT_STATUS = ["pending", "authorized", "captured", "failed", "refunded", "partially_refunded"] as const;

export const orderListQuery = listBase.extend({
  status: z.enum(ADMIN_ORDER_STATUS).optional(),
  paymentStatus: z.enum(ORDER_PAYMENT_STATUS).optional(),
  customer: objectId.optional(),
  method: z.enum(["upi", "card", "netbanking"]).optional(),
  sort: z.enum(["created", "total"]).default("created"),
});

export const bulkOrderStatusBody = z.object({
  ids: z
    .array(z.string().trim().toUpperCase().regex(/^MM[A-Z0-9]{4,12}$/, "Invalid order number."))
    .min(1, "Select at least one order.")
    .max(50, "Update at most 50 orders at a time."),
  status: z.enum(["Confirmed", "Processing", "Packed", "Shipped", "Out for Delivery", "Delivered"]),
});

export const orderNumberParams = z.object({
  id: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^MM[A-Z0-9]{4,12}$/, "Invalid order number."),
});

export const orderStatusBody = z.object({
  status: z.enum(["Confirmed", "Processing", "Packed", "Shipped", "Out for Delivery", "Delivered", "Cancelled"]),
  note: text(500).optional().default(""),
});

export const orderNoteBody = z.object({ text: text(2000).min(1, "Write a note first.") });

/* ---------- Payments ---------- */

export const PAYMENT_RECORD_STATUS = ["created", "authorized", "captured", "failed", "refunded", "partially_refunded"] as const;

export const paymentListQuery = listBase.extend({
  status: z.enum(PAYMENT_RECORD_STATUS).optional(),
  /** Tab shortcut: paid = captured; refunded = refunded or partially refunded. */
  group: z.enum(["paid", "failed", "refunded"]).optional(),
  method: z.enum(["upi", "card", "netbanking"]).optional(),
  mode: z.enum(["test", "live"]).optional(),
  sort: z.enum(["created", "amount"]).default("created"),
});

export const paymentParams = z.object({ id: objectId });

export const refundBody = z.object({
  /** Paise. Omit for a full refund of what is left. */
  amountPaise: z.number().int("Amount must be whole paise.").min(100, "The smallest refund is ₹1.").optional(),
  reason: text(200).min(3, "Give a short reason for the refund."),
  /** Random per refund attempt — resending the same key never refunds twice. */
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, "Invalid request key."),
});

export const refundParams = z.object({ id: objectId, refundId: z.string().regex(/^rfnd_[A-Za-z0-9]{6,40}$/, "Invalid refund ID.") });
