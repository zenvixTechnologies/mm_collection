import "server-only";
import { Types, type PipelineStage } from "mongoose";
import type { z } from "zod";
import type { Address, Audience } from "@/types";
import type { CustomerWithStats } from "@/types/admin";
import { revokeAllSessions } from "@/server/auth/session.service";
import { connectToDatabase } from "@/server/db/connect";
import { notFound } from "@/server/http/errors";
import { Order } from "@/server/models/order.model";
import { User } from "@/server/models/user.model";
import type { customerListQuery, customerUpdateBody } from "@/server/validation/admin-sales";
import { audit, type AuditActor } from "./audit.service";
import { PAID_STATUSES, dateRange, escapeRegex, pageOf, toAdminOrder, type AdminOrderDoc } from "./admin-sales.shared";

/**
 * Admin customers: accounts with figures computed from their real orders. Only safe profile
 * fields are ever projected — never password hashes, reset tokens, login counters or sessions.
 */

const VIP_SPEND_PAISE = 1_000_000; // ₹10,000 — matches the dashboard's "High value" segment
const NEW_DAYS = 30;

interface CustomerAgg {
  _id: Types.ObjectId;
  fullName: string;
  email: string;
  mobile?: string | null;
  status: "active" | "blocked";
  addresses?: { address: Address; isDefault?: boolean }[];
  primaryAudience?: string | null;
  marketingOptIn?: boolean;
  adminNotes?: string;
  createdAt: Date;
  orderCount: number;
  spentPaise: number;
  lastOrderAt: Date | null;
}

const SAFE_FIELDS = { fullName: 1, email: 1, mobile: 1, status: 1, addresses: 1, primaryAudience: 1, marketingOptIn: 1, adminNotes: 1, createdAt: 1 } as const;

/** Per-customer paid-order figures, joined from the orders collection. */
const STATS: PipelineStage[] = [
  {
    $lookup: {
      from: "orders",
      let: { uid: "$_id" },
      pipeline: [
        { $match: { $expr: { $eq: ["$user", "$$uid"] }, paymentStatus: { $in: [...PAID_STATUSES] } } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            spent: { $sum: { $subtract: ["$totalPaise", { $ifNull: ["$refundedPaise", 0] }] } },
            last: { $max: "$createdAt" },
          },
        },
      ],
      as: "stats",
    },
  },
  {
    $addFields: {
      orderCount: { $ifNull: [{ $first: "$stats.count" }, 0] },
      spentPaise: { $ifNull: [{ $first: "$stats.spent" }, 0] },
      lastOrderAt: { $ifNull: [{ $first: "$stats.last" }, null] },
    },
  },
];

function segmentMatch(segment: z.output<typeof customerListQuery>["segment"], now = Date.now()) {
  switch (segment) {
    case "new":
      return { createdAt: { $gte: new Date(now - NEW_DAYS * 86_400_000) } };
    case "repeat":
      return { orderCount: { $gte: 2 } };
    case "vip":
      return { spentPaise: { $gte: VIP_SPEND_PAISE } };
    case "blocked":
      return { status: "blocked" };
    default:
      return {};
  }
}

function toCustomer(c: CustomerAgg): CustomerWithStats {
  const addresses = [...(c.addresses ?? [])].sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault));
  return {
    id: String(c._id),
    fullName: c.fullName,
    email: c.email,
    mobile: c.mobile ?? "",
    joinedAt: new Date(c.createdAt).toISOString(),
    status: c.status ?? "active",
    addresses: addresses.map(({ address: a }) => ({ house: a.house, street: a.street, city: a.city, district: a.district, state: a.state, pincode: a.pincode })),
    primaryAudience: (c.primaryAudience ?? "women") as Audience,
    marketingOptIn: !!c.marketingOptIn,
    notes: c.adminNotes ?? "",
    orderCount: c.orderCount,
    totalSpent: c.spentPaise / 100,
    lastOrderAt: c.lastOrderAt ? new Date(c.lastOrderAt).toISOString() : null,
  };
}

const SORT_FIELD = { joined: "createdAt", name: "fullName", orders: "orderCount", spent: "spentPaise", last: "lastOrderAt" } as const;

export async function listCustomers(q: z.output<typeof customerListQuery>) {
  await connectToDatabase();
  const base: Record<string, unknown> = {};
  if (q.status) base.status = q.status;
  const joined = dateRange(q.from, q.to);
  if (joined) base.createdAt = joined;
  if (q.q) {
    const term = escapeRegex(q.q);
    const digits = q.q.replace(/\D/g, "");
    base.$or = [
      { fullName: { $regex: term, $options: "i" } },
      { email: { $regex: term, $options: "i" } },
      ...(digits.length >= 3 ? [{ mobile: { $regex: escapeRegex(digits.slice(-10)) } }] : []),
    ];
  }

  const dir = q.dir === "asc" ? 1 : -1;
  const [result] = await User.aggregate<{ rows: CustomerAgg[]; total: { n: number }[]; counts: Record<string, { n: number }[]> }>([
    { $match: base },
    { $project: SAFE_FIELDS },
    ...STATS,
    { $project: { stats: 0 } },
    {
      $facet: {
        rows: [{ $match: segmentMatch(q.segment) }, { $sort: { [SORT_FIELD[q.sort]]: dir, _id: 1 } }, { $skip: (q.page - 1) * q.limit }, { $limit: q.limit }],
        total: [{ $match: segmentMatch(q.segment) }, { $count: "n" }],
        all: [{ $count: "n" }],
        new: [{ $match: segmentMatch("new") }, { $count: "n" }],
        repeat: [{ $match: segmentMatch("repeat") }, { $count: "n" }],
        vip: [{ $match: segmentMatch("vip") }, { $count: "n" }],
        blocked: [{ $match: segmentMatch("blocked") }, { $count: "n" }],
      },
    },
    {
      $project: {
        rows: 1,
        total: 1,
        counts: { all: "$all", new: "$new", repeat: "$repeat", vip: "$vip", blocked: "$blocked" },
      },
    },
  ]);
  const n = (arr?: { n: number }[]) => arr?.[0]?.n ?? 0;
  const segments = Object.fromEntries(Object.entries(result?.counts ?? {}).map(([k, v]) => [k, n(v)]));
  return { ...pageOf((result?.rows ?? []).map(toCustomer), q.page, q.limit, n(result?.total)), segments };
}

async function loadCustomer(id: string) {
  const [c] = await User.aggregate<CustomerAgg>([{ $match: { _id: new Types.ObjectId(id) } }, { $project: SAFE_FIELDS }, ...STATS, { $project: { stats: 0 } }]);
  if (!c) throw notFound("Customer not found.");
  return c;
}

/** A customer with their figures and their most recent orders (newest first). */
export async function getCustomer(id: string) {
  await connectToDatabase();
  const c = await loadCustomer(id);
  const [orders, orderTotal] = await Promise.all([
    Order.find({ user: c._id }).sort({ createdAt: -1 }).limit(100).lean<AdminOrderDoc[]>(),
    Order.countDocuments({ user: c._id }),
  ]);
  return { customer: toCustomer(c), orders: orders.map(toAdminOrder), orderTotal };
}

/**
 * Block/unblock and staff notes. Blocking signs the customer out everywhere at once (their
 * sessions are revoked) and stops future sign-ins; existing orders are untouched.
 */
export async function updateCustomer(id: string, input: z.output<typeof customerUpdateBody>, actor: AuditActor) {
  await connectToDatabase();
  const before = await User.findById(id, { status: 1, adminNotes: 1, email: 1 }).lean();
  if (!before) throw notFound("Customer not found.");
  const set: Record<string, unknown> = {};
  if (input.status !== undefined && input.status !== before.status) set.status = input.status;
  if (input.notes !== undefined && input.notes !== (before.adminNotes ?? "")) set.adminNotes = input.notes;

  if (Object.keys(set).length) {
    await User.updateOne({ _id: id }, { $set: set });
    if (set.status === "blocked") await revokeAllSessions("user", id, "admin");
    if (set.status) {
      await audit(actor, set.status === "blocked" ? "customer.block" : "customer.unblock", { type: "customer", id, label: before.email }, {
        status: { from: before.status, to: set.status },
      });
    }
    if (set.adminNotes !== undefined) await audit(actor, "customer.notes", { type: "customer", id, label: before.email }, { notesChanged: true });
  }
  return getCustomer(id);
}
