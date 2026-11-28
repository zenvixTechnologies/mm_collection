import "server-only";
import { createHash } from "node:crypto";
import { Types, type ClientSession } from "mongoose";
import type { z } from "zod";
import type { OrderProductReview, ProductReview, ProductReviewList } from "@/types";
import type { AdminReview } from "@/types/admin";
import { logger, serializeError } from "@/server/utils/logger";
import { connectToDatabase } from "@/server/db/connect";
import { withTransaction } from "@/server/db/transaction";
import { AppError, badRequest, conflict, notFound } from "@/server/http/errors";
import { paginationMeta } from "@/server/http/response";
import { MediaAsset } from "@/server/models/media-asset.model";
import { Order, type ORDER_STATUSES } from "@/server/models/order.model";
import { Payment } from "@/server/models/payment.model";
import { Product } from "@/server/models/product.model";
import { Review } from "@/server/models/review.model";
import { User } from "@/server/models/user.model";
import type { adminReviewListQuery, orderReviewBody } from "@/server/validation/review";
import { productRefFilter, refreshStorefront } from "./admin-catalog.shared";
import { escapeRegex } from "./admin-sales.shared";
import { audit, type AuditActor } from "./audit.service";
import { cleanupImages } from "./media.service";

/**
 * Verified-purchase reviews. Eligibility comes only from the stored order and payment records —
 * nothing the browser says about a purchase is read. Product ratings are recalculated from
 * verified reviews alone, in the same transaction that adds or removes one.
 */

type OrderStatus = (typeof ORDER_STATUSES)[number];
/** Orders still on their way: reviewable later, once delivered. */
const ON_THE_WAY: OrderStatus[] = ["pending_payment", "placed", "confirmed", "processing", "packed", "shipped", "out_for_delivery"];
/** Money kept in full or in part. "refunded" (fully, including a pending full refund) is excluded. */
const HELD_PAYMENT = ["captured", "partially_refunded"] as const;
const PUBLISHED = { verifiedAt: { $ne: null } } as const;
/** An uploaded photo must be used within this long; the cleanup job removes unused ones after 24 h. */
const PHOTO_USABLE_MS = 12 * 3600_000;

interface ReviewOrder {
  _id: Types.ObjectId;
  status: OrderStatus;
  paymentStatus: string;
  totalPaise: number;
  refundedPaise?: number;
  razorpayPaymentId?: string | null;
  items: { product: Types.ObjectId; variantSku: string }[];
}

/** The customer's own order. Anyone else's gets the same answer as one that doesn't exist. */
async function ownOrder(userId: string, orderNumber: string, session?: ClientSession) {
  const order = await Order.findOne({ orderNumber, user: userId }, { status: 1, paymentStatus: 1, totalPaise: 1, refundedPaise: 1, razorpayPaymentId: 1, items: 1 })
    .session(session ?? null)
    .lean<ReviewOrder>();
  if (!order) throw notFound("Order not found.");
  return order;
}

/** The payment record proving the order's money is held, or null. */
async function heldPayment(order: ReviewOrder, session?: ClientSession) {
  if (!(HELD_PAYMENT as readonly string[]).includes(order.paymentStatus) || !order.razorpayPaymentId || (order.refundedPaise ?? 0) >= order.totalPaise) return null;
  return Payment.findOne({ order: order._id, razorpayPaymentId: order.razorpayPaymentId, status: { $in: [...HELD_PAYMENT] } }, { _id: 1 })
    .session(session ?? null)
    .lean();
}

/**
 * Whether this signed-in customer may review this product from this order, decided only from
 * stored records: their own order, containing the product, delivered, with its payment held, and
 * no review of the product yet. Throws the reason otherwise.
 */
export async function assertCanReview(userId: string, orderNumber: string, productId: string, session?: ClientSession) {
  await connectToDatabase();
  const order = await ownOrder(userId, orderNumber, session);
  const item = order.items.find((i) => String(i.product) === productId.toLowerCase());
  if (!item) throw new AppError(403, "FORBIDDEN", "That product isn't part of this order.");
  if (!(await Product.exists({ _id: item.product }).session(session ?? null))) throw notFound("Product not found.");
  if (await Review.exists({ user: userId, product: item.product }).session(session ?? null)) throw alreadyReviewed();
  if (ON_THE_WAY.includes(order.status)) throw new AppError(403, "FORBIDDEN", "You can review this product after delivery.");
  const payment = order.status === "delivered" ? await heldPayment(order, session) : null;
  if (!payment) throw new AppError(403, "FORBIDDEN", "This order isn't eligible for reviews.");
  return { product: item.product, order: order._id, payment: payment._id as Types.ObjectId, variantSku: item.variantSku };
}

async function publicProductDbId(ref: string) {
  const p = await Product.findOne({ status: "active", visible: true, ...productRefFilter(ref) }, { _id: 1 }).lean();
  if (!p) throw notFound("Product not found.");
  return p._id as Types.ObjectId;
}

/**
 * The review's ID is derived from the customer and product, so the always-present _id index
 * allows only one each — even where the other indexes haven't been built yet.
 */
const reviewId = (userId: string, productId: Types.ObjectId) =>
  new Types.ObjectId(createHash("sha256").update(`review:${userId}:${String(productId)}`).digest("hex").slice(0, 24));

/** "Asha Menon" → "Asha M." — the full name is never published. */
export function displayName(fullName: string) {
  const [first = "", ...rest] = fullName.trim().split(/\s+/);
  const initial = rest.at(-1)?.[0];
  return `${first.slice(0, 60) || "Customer"}${initial ? ` ${initial.toUpperCase()}.` : ""}`;
}

/** The public shape: an explicit allow-list, so no order, payment or account detail can leak. */
const toPublic = (r: { _id: unknown; authorName: string; rating: number; title?: string | null; comment: string; createdAt?: Date; images?: { url: string; width?: number | null; height?: number | null }[] | null }): ProductReview => ({
  id: String(r._id),
  authorName: r.authorName,
  rating: r.rating,
  title: r.title ?? "",
  comment: r.comment,
  createdAt: new Date(r.createdAt ?? 0).toISOString(),
  images: (r.images ?? []).map((i) => ({ url: i.url, width: i.width ?? 0, height: i.height ?? 0 })),
});

const alreadyReviewed = () => conflict("You've already reviewed this product.");

/** Star counts [5★ … 1★] over verified reviews only. */
async function starCounts(productId: Types.ObjectId, session?: ClientSession) {
  const rows = await Review.aggregate<{ _id: number; n: number }>([{ $match: { product: productId, ...PUBLISHED } }, { $group: { _id: "$rating", n: { $sum: 1 } } }]).session(session ?? null);
  const distribution = [5, 4, 3, 2, 1].map((stars) => rows.find((r) => r._id === stars)?.n ?? 0);
  const count = distribution.reduce((a, b) => a + b, 0);
  const sum = distribution.reduce((total, n, i) => total + n * (5 - i), 0);
  return { distribution, count, average: count ? Math.round((sum / count) * 100) / 100 : 0 };
}

/** Writes the product's rating summary. Writing the product also serialises concurrent changes. */
async function recalculate(productId: Types.ObjectId, session: ClientSession) {
  const { count, average } = await starCounts(productId, session);
  await Product.updateOne({ _id: productId }, { $set: { reviewStats: { average, count } } }, { session, timestamps: false });
}

/* ---------- Storefront ---------- */

export async function listProductReviews(ref: string, page: number, limit: number): Promise<ProductReviewList> {
  await connectToDatabase();
  const productId = await publicProductDbId(ref);
  const [docs, summary] = await Promise.all([
    Review.find({ product: productId, ...PUBLISHED })
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    starCounts(productId),
  ]);
  return { ...summary, items: docs.map(toPublic), page, totalPages: paginationMeta(page, limit, summary.count).totalPages };
}

/* ---------- The customer's order page ---------- */

/** One entry per product on the customer's own order, each decided separately. */
export async function listOrderReviews(userId: string, orderNumber: string): Promise<OrderProductReview[]> {
  await connectToDatabase();
  const order = await ownOrder(userId, orderNumber);
  const ids = [...new Map(order.items.map((i) => [String(i.product), i.product])).values()];
  const [mine, existing, payment] = await Promise.all([
    Review.find({ user: userId, product: { $in: ids } }).lean(),
    Product.find({ _id: { $in: ids } }, { _id: 1 }).lean(),
    heldPayment(order),
  ]);
  const reviewOf = new Map(mine.map((r) => [String(r.product), r]));
  const known = new Set(existing.map((p) => String(p._id)));
  return ids.map((id) => {
    const productId = String(id);
    const review = reviewOf.get(productId);
    if (review) return { productId, status: "reviewed", review: review.verifiedAt ? toPublic(review) : null };
    const status = !known.has(productId)
      ? "unavailable"
      : order.status === "delivered"
        ? payment
          ? "eligible"
          : "unavailable"
        : ON_THE_WAY.includes(order.status) && order.paymentStatus !== "refunded"
          ? "awaiting_delivery"
          : "unavailable";
    return { productId, status, review: null };
  });
}

/** Turns the customer's own checked, unused uploads into the review's photos, in their order. */
async function attachPhotos(ids: string[], userId: string, productId: Types.ObjectId, session: ClientSession) {
  if (!ids.length) return [];
  const filter = { _id: { $in: ids }, purpose: "review" as const, customer: userId, product: productId, status: "uploaded" as const, createdAt: { $gt: new Date(Date.now() - PHOTO_USABLE_MS) } };
  const assets = await MediaAsset.find(filter).session(session).lean();
  const byId = new Map(assets.map((a) => [String(a._id), a]));
  const images = ids.map((id) => byId.get(id.toLowerCase()));
  const unusable = () => badRequest("One of your photos is no longer available. Remove it and add it again.");
  if (images.some((a) => !a?.url)) throw unusable();
  const claimed = await MediaAsset.updateMany(filter, { $set: { status: "attached" } }, { session });
  if (claimed.modifiedCount !== ids.length) throw unusable();
  return images.map((a) => ({ publicId: a!.publicId, url: a!.url!, width: a!.width ?? 0, height: a!.height ?? 0 }));
}

export async function createReview(userId: string, orderNumber: string, input: z.output<typeof orderReviewBody>): Promise<ProductReview> {
  await connectToDatabase();
  const user = await User.findById(userId, { fullName: 1 }).lean();
  if (!user) throw new AppError(401, "UNAUTHORIZED", "Please log in to continue.");
  let saved;
  try {
    saved = await withTransaction(async (session) => {
      const purchase = await assertCanReview(userId, orderNumber, input.productId, session);
      const images = await attachPhotos(input.imageIds, userId, purchase.product, session);
      // Only the rating, comment and photo IDs come from the request; the rest is derived here.
      const [doc] = await Review.create(
        [{ _id: reviewId(userId, purchase.product), user: userId, ...purchase, authorName: displayName(user.fullName), rating: input.rating, comment: input.comment, images, verifiedAt: new Date() }],
        { session },
      );
      await recalculate(purchase.product, session);
      return doc.toObject();
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw alreadyReviewed();
    throw err;
  }
  refreshStorefront();
  return toPublic(saved);
}

/* ---------- Admin: view and delete only ---------- */

export async function adminListReviews(q: z.output<typeof adminReviewListQuery>) {
  await connectToDatabase();
  const filter: Record<string, unknown> = {};
  if (q.rating) filter.rating = q.rating;
  if (q.q) {
    const term = { $regex: escapeRegex(q.q), $options: "i" };
    const products = await Product.find({ name: term }, { _id: 1 }).limit(200).lean();
    filter.$or = [{ authorName: term }, { comment: term }, { product: { $in: products.map((p) => p._id) } }];
  }
  const [docs, total] = await Promise.all([
    Review.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    Review.countDocuments(filter),
  ]);
  const [products, orders] = await Promise.all([
    Product.find({ _id: { $in: docs.map((d) => d.product) } }, { name: 1, slug: 1 }).lean(),
    Order.find({ _id: { $in: docs.map((d) => d.order) } }, { orderNumber: 1, status: 1, paymentStatus: 1 }).lean(),
  ]);
  const productById = new Map(products.map((p) => [String(p._id), p]));
  const orderById = new Map(orders.map((o) => [String(o._id), o]));
  const items: AdminReview[] = docs.map((d) => {
    const product = productById.get(String(d.product));
    const order = orderById.get(String(d.order));
    return {
      ...toPublic(d),
      productName: product?.name ?? "Deleted product",
      productSlug: product?.slug ?? null,
      verified: !!d.verifiedAt,
      orderNumber: order?.orderNumber ?? null,
      // The review was verified when written; staff are told if the order has changed since.
      orderNow: order?.status === "cancelled" ? "cancelled" : order?.paymentStatus === "refunded" ? "refunded" : null,
    };
  });
  return { items, meta: paginationMeta(q.page, q.limit, total) };
}

/** Permanently removes a review, takes it out of the product's rating and deletes its photos. */
export async function adminDeleteReview(id: string, actor: AuditActor) {
  const removed = await withTransaction(async (session) => {
    const doc = await Review.findOneAndDelete({ _id: id }, { session }).lean();
    if (!doc) throw notFound("Review not found.");
    await recalculate(doc.product as Types.ObjectId, session);
    // Released, so nobody can attach them again and the cleanup job retries if deleting fails.
    const photos = (doc.images ?? []).map((i) => i.publicId);
    if (photos.length) await MediaAsset.updateMany({ publicId: { $in: photos }, purpose: "review" }, { $set: { status: "uploaded", customer: null } }, { session });
    return doc;
  });
  // Deletes only images nothing else refers to, and never fails the review's deletion.
  await cleanupImages((removed.images ?? []).map((i) => i.publicId)).catch((err: unknown) => logger.warn("review.photo_cleanup_failed", { reviewId: id, error: serializeError(err) }));
  await audit(actor, "review.delete", { type: "review", id, label: removed.authorName }, { product: String(removed.product), order: String(removed.order), rating: removed.rating, verified: !!removed.verifiedAt });
  refreshStorefront();
  return { id };
}
