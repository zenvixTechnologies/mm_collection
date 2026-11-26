import "server-only";
import type { Types } from "mongoose";
import type { AdminOrder, AdminOrderStatus, PaymentStatus } from "@/types/admin";
import { paginationMeta } from "@/server/http/response";
import { STATUS_LABEL, toOrderView, type OrderDoc } from "./order.service";

/**
 * Shared by the admin customers, orders and payments services: stored orders → the admin
 * dashboard's AdminOrder shape, and the fulfilment rules an admin may apply.
 */

export type DbOrderStatus = keyof typeof STATUS_LABEL;

/** Paid orders count towards revenue and order totals (net of refunds). */
export const PAID_STATUSES = ["captured", "partially_refunded", "refunded"] as const;

export const escapeRegex = (term: string) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** AdminOrderStatus (as the UI shows it) → the stored status. */
export const DB_STATUS_FOR = Object.fromEntries(Object.entries(STATUS_LABEL).map(([db, label]) => [label, db])) as Record<AdminOrderStatus, DbOrderStatus>;

/**
 * Fulfilment moves an admin may make. Only paid orders move forward; payment itself is never set
 * by an admin (Razorpay verification and webhooks do that). Cancelling is possible until the
 * order ships; an unpaid order can be cancelled too (after checking Razorpay — see the service).
 */
export const FULFILMENT_NEXT: Partial<Record<DbOrderStatus, DbOrderStatus[]>> = {
  pending_payment: ["cancelled"],
  placed: ["confirmed", "processing", "shipped", "cancelled"],
  confirmed: ["processing", "shipped", "cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["out_for_delivery", "delivered"],
  out_for_delivery: ["delivered"],
};

export interface AdminOrderDoc extends OrderDoc {
  user?: Types.ObjectId | null;
  refundedPaise?: number;
  tracking?: { courier?: string; awb?: string; url?: string; shippedAt?: Date } | null;
  notes?: { _id: Types.ObjectId; author?: { name?: string }; text: string; at: Date }[];
  statusHistory?: { status: DbOrderStatus; at: Date; by?: { type?: string; name?: string }; note?: string }[];
  exception?: { code?: string; message?: string; at?: Date | null; resolvedAt?: Date | null } | null;
}

export function allowedTransitions(o: Pick<AdminOrderDoc, "status" | "paymentStatus">): AdminOrderStatus[] {
  const next = FULFILMENT_NEXT[o.status as DbOrderStatus] ?? [];
  // Forward moves need a paid order (a refunded order can still be cancelled, nothing else).
  const paid = o.paymentStatus === "captured" || o.paymentStatus === "partially_refunded";
  return next
    .filter((s) => s === "cancelled" || paid)
    .map((s) => STATUS_LABEL[s] as AdminOrderStatus);
}

export function toAdminOrder(o: AdminOrderDoc): AdminOrder {
  const view = toOrderView(o);
  return {
    ...view,
    status: view.status as AdminOrderStatus,
    history: view.history as AdminOrder["history"],
    customerId: o.user ? String(o.user) : "",
    guest: !o.user,
    paymentStatus: (o.paymentStatus as PaymentStatus) ?? "pending",
    refunded: (o.refundedPaise ?? 0) / 100,
    tracking: o.tracking?.awb
      ? { courier: o.tracking.courier ?? "", awb: o.tracking.awb, url: o.tracking.url || undefined, shippedAt: o.tracking.shippedAt ? new Date(o.tracking.shippedAt).toISOString() : undefined }
      : undefined,
    notes: (o.notes ?? [])
      .map((n) => ({ id: String(n._id), author: n.author?.name ?? "Staff", text: n.text, createdAt: new Date(n.at).toISOString() }))
      .reverse(),
    exception:
      o.exception?.code && !o.exception.resolvedAt
        ? { code: o.exception.code, message: o.exception.message ?? "", at: o.exception.at ? new Date(o.exception.at).toISOString() : null }
        : null,
    timeline: (o.statusHistory ?? []).map((h) => ({
      status: STATUS_LABEL[h.status] as AdminOrderStatus,
      at: new Date(h.at).toISOString(),
      by: h.by?.name ?? "system",
      note: h.note ?? "",
    })),
    allowedTransitions: allowedTransitions(o),
  };
}

export function pageOf<T>(items: T[], page: number, limit: number, total: number) {
  return { items, meta: paginationMeta(page, limit, total) };
}

/** createdAt range filter from optional from/to dates (to is inclusive of the whole day). */
export function dateRange(from?: Date, to?: Date) {
  if (!from && !to) return undefined;
  const range: Record<string, Date> = {};
  if (from) range.$gte = from;
  if (to) range.$lte = new Date(to.getTime() + (to.getUTCHours() === 0 && to.getUTCMinutes() === 0 ? 86_399_999 : 0));
  return range;
}
