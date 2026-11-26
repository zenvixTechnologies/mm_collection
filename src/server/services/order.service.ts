import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Types } from "mongoose";
import type { Address, Audience, PaymentMethod, Size, StoreOrder, StoreOrderStatus } from "@/types";
import { getEnv } from "@/server/config/env";
import { connectToDatabase } from "@/server/db/connect";
import { withTransaction } from "@/server/db/transaction";
import { notFound } from "@/server/http/errors";
import { Order, type ORDER_STATUSES } from "@/server/models/order.model";
import { logger, serializeError } from "@/server/utils/logger";
import { releaseCouponUse } from "./coupon.service";
import { releaseVariant, type StockActor } from "./stock-reservation.service";

type DbStatus = (typeof ORDER_STATUSES)[number];

/** How long checkout holds stock for an unpaid order. */
export const RESERVATION_MINUTES = 30;

/* ---------- Guest access tokens ---------- */

/**
 * Guests prove they placed an order with a token derived from a server secret and a random
 * per-order nonce: HMAC-SHA256(key, orderId:nonce). Nothing that could be replayed is stored,
 * and the same token can be handed out again when a checkout request is retried. Order numbers
 * alone never grant access, so they can't be enumerated.
 */
function accessKey() {
  return createHmac("sha256", getEnv("auth").JWT_ACCESS_SECRET).update("mm:order-access:v1").digest();
}

export const newAccessNonce = () => randomBytes(16).toString("hex");

export function orderAccessToken(orderId: Types.ObjectId | string, nonce: string) {
  return createHmac("sha256", accessKey()).update(`${String(orderId)}:${nonce}`).digest("base64url");
}

function tokenMatches(given: string, orderId: Types.ObjectId, nonce: string | null | undefined) {
  if (!nonce) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(orderAccessToken(orderId, nonce));
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ---------- Order numbers ---------- */

// No 0/O/1/I/L — easy to read out over the phone.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** MM + 8 random characters (~39 bits). Uniqueness is enforced by the unique index. */
export function newOrderNumber() {
  const bytes = randomBytes(8);
  let out = "MM";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/* ---------- Storefront view ---------- */

export const STATUS_LABEL: Record<DbStatus, StoreOrderStatus> = {
  pending_payment: "Payment Pending",
  placed: "Order Placed",
  confirmed: "Confirmed",
  processing: "Processing",
  shipped: "Shipped",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
  expired: "Expired",
  payment_failed: "Payment Failed",
};

export interface OrderDoc {
  _id: Types.ObjectId;
  orderNumber: string;
  user?: Types.ObjectId | null;
  customer: { fullName: string; email: string; mobile: string };
  shippingAddress: Address & { country?: string };
  items: {
    product: Types.ObjectId;
    variantSku: string;
    name: string;
    slug: string;
    image?: { url: string } | null;
    audience?: string | null;
    size?: string | null;
    color?: string | null;
    unitPricePaise: number;
    mrpPaise: number;
    quantity: number;
    lineTotalPaise: number;
  }[];
  subtotalPaise: number;
  mrpTotalPaise: number;
  discountPaise: number;
  shippingPaise?: number | null;
  totalPaise: number;
  coupon?: { code?: string | null; discountPaise?: number } | null;
  paymentMethod?: PaymentMethod | null;
  status: DbStatus;
  paymentStatus: string;
  razorpayOrderId?: string | null;
  razorpayPaymentId?: string | null;
  paymentMode?: "test" | "live" | null;
  paidAt?: Date | null;
  paymentAttemptCount?: number;
  statusHistory?: { status: DbStatus; at: Date }[];
  reservationExpiresAt?: Date | null;
  stockReleased?: boolean;
  accessNonce?: string | null;
  createdAt: Date;
}

/** The storefront's Order shape. Contains no database IDs other than product references. */
export function toOrderView(o: OrderDoc): StoreOrder {
  const history: StoreOrder["history"] = {};
  for (const h of o.statusHistory ?? []) history[STATUS_LABEL[h.status]] ??= new Date(h.at).toISOString();
  const a = o.shippingAddress;
  return {
    id: o.orderNumber,
    createdAt: new Date(o.createdAt).toISOString(),
    items: o.items.map((i) => ({
      productId: String(i.product),
      audience: (i.audience ?? undefined) as Audience | undefined,
      slug: i.slug,
      name: i.name,
      image: i.image?.url ?? "",
      price: i.unitPricePaise / 100,
      mrp: i.mrpPaise / 100,
      sku: i.variantSku,
      size: (i.size ?? null) as Size | null,
      color: i.color ?? null,
      quantity: i.quantity,
    })),
    customer: { fullName: o.customer.fullName, email: o.customer.email, mobile: o.customer.mobile },
    address: { house: a.house, street: a.street, city: a.city, district: a.district, state: a.state, pincode: a.pincode },
    paymentMethod: o.paymentMethod ?? "upi",
    reservedUntil: o.status === "pending_payment" && o.reservationExpiresAt ? new Date(o.reservationExpiresAt).toISOString() : null,
    couponCode: o.coupon?.code ?? null,
    subtotal: o.subtotalPaise / 100,
    discount: o.discountPaise / 100,
    shipping: o.shippingPaise == null ? null : o.shippingPaise / 100,
    total: o.totalPaise / 100,
    status: STATUS_LABEL[o.status],
    history,
    paymentState: paymentStateOf(o),
    ...(o.paymentStatus === "captured" && o.razorpayPaymentId
      ? {
          payment: {
            provider: "razorpay" as const,
            mode: o.paymentMode ?? "test",
            razorpayOrderId: o.razorpayOrderId ?? "",
            razorpayPaymentId: o.razorpayPaymentId,
            currency: "INR" as const,
            amount: o.totalPaise / 100,
          },
        }
      : {}),
  };
}

export function paymentStateOf(o: Pick<OrderDoc, "paymentStatus">): NonNullable<StoreOrder["paymentState"]> {
  switch (o.paymentStatus) {
    case "captured":
      return "paid";
    case "refunded":
    case "partially_refunded":
      return "refunded";
    case "failed":
      return "failed";
    default:
      return "pending";
  }
}

/* ---------- Reads ---------- */

/** A signed-in customer's orders, newest first. */
export async function listCustomerOrders(userId: string, { page, limit }: { page: number; limit: number }) {
  await connectToDatabase();
  const filter = { user: userId };
  const [docs, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean<OrderDoc[]>(),
    Order.countDocuments(filter),
  ]);
  return { orders: docs.map(toOrderView), total };
}

/**
 * One order, for its owner only: the signed-in customer it belongs to, or whoever holds its
 * guest access token. Anyone else gets the same 404 as for an order that doesn't exist.
 */
export async function getOrderForViewer(orderNumber: string, viewer: OrderViewer) {
  return toOrderView(await loadOrderForViewer(orderNumber, viewer));
}

export interface OrderViewer {
  userId?: string | null;
  token?: string | null;
}

/** The stored order (raw), after the same ownership check as getOrderForViewer. */
export async function loadOrderForViewer(orderNumber: string, viewer: OrderViewer) {
  await connectToDatabase();
  const order = await Order.findOne({ orderNumber }).select("+accessNonce").lean<OrderDoc>();
  const owns = !!order && !!viewer.userId && !!order.user && String(order.user) === viewer.userId;
  const hasToken = !!order && !!viewer.token && tokenMatches(viewer.token, order._id, order.accessNonce);
  if (!order || !(owns || hasToken)) throw notFound("We couldn't find that order.");
  return order;
}

/* ---------- Ending unpaid orders ---------- */

type EndStatus = Extract<DbStatus, "expired" | "cancelled" | "payment_failed">;

/**
 * Ends an unpaid order and gives back everything it held — reserved stock (ledger "release") and
 * its coupon use — in one transaction. Only a `pending_payment` order whose stock has not been
 * released yet is touched, so running this twice (or racing the cron) is harmless.
 */
export async function releaseUnpaidOrder(orderId: Types.ObjectId, to: EndStatus, actor: StockActor, note: string) {
  return withTransaction(async (session) => {
    const order = await Order.findOneAndUpdate(
      { _id: orderId, status: "pending_payment", stockReleased: false, paymentStatus: { $ne: "captured" } },
      {
        $set: { status: to, stockReleased: true, ...(to === "payment_failed" ? { paymentStatus: "failed" } : {}) },
        $push: { statusHistory: { status: to, at: new Date(), by: actor, note } },
      },
      { session, returnDocument: "after", projection: { items: 1 } },
    ).lean<Pick<OrderDoc, "_id" | "items">>();
    if (!order) return false;

    const held = new Map<string, { product: Types.ObjectId; quantity: number }>();
    for (const i of order.items) {
      const cur = held.get(i.variantSku);
      if (cur) cur.quantity += i.quantity;
      else held.set(i.variantSku, { product: i.product, quantity: i.quantity });
    }
    for (const [sku, h] of held) {
      await releaseVariant(session, { productId: h.product, sku, quantity: h.quantity, orderId, actor, note });
    }
    await releaseCouponUse(orderId, session);
    return true;
  });
}

/** Asked before an overdue order is released: may the hold go ("release") or not yet ("keep")? */
export type ExpiryCheck = (order: { _id: Types.ObjectId; paymentAttemptCount?: number; reservationExpiresAt?: Date | null }) => Promise<"release" | "keep">;

/**
 * Expires unpaid orders whose hold time has passed, oldest first. Called by the cron endpoint and,
 * opportunistically, before checkout — so abandoned checkouts never keep stock off sale for long.
 * `check` (the payment service's) asks the gateway first, so stock is never released while a
 * payment for the order succeeded or may still be processing.
 */
export async function expireStaleOrders({ limit = 50, now = new Date(), check }: { limit?: number; now?: Date; check?: ExpiryCheck } = {}) {
  await connectToDatabase();
  const due = await Order.find(
    { status: "pending_payment", stockReleased: false, reservationExpiresAt: { $lte: now } },
    { _id: 1, paymentAttemptCount: 1, reservationExpiresAt: 1 },
  )
    .sort({ reservationExpiresAt: 1 })
    .limit(limit)
    .lean<{ _id: Types.ObjectId; paymentAttemptCount?: number; reservationExpiresAt?: Date | null }[]>();
  let expired = 0;
  for (const o of due) {
    try {
      if (check && (await check(o)) === "keep") continue;
      if (await releaseUnpaidOrder(o._id, "expired", { type: "system", name: "reservation expiry" }, "Payment not completed in time")) expired++;
    } catch (err) {
      logger.error("order.expire_failed", { orderId: String(o._id), error: serializeError(err) });
    }
  }
  if (expired) logger.info("order.expired_reservations", { expired });
  return { checked: due.length, expired };
}
