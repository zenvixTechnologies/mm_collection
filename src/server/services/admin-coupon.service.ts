import "server-only";
import { isValidObjectId, Types } from "mongoose";
import type { z } from "zod";
import type { AdminCoupon, AdminOffer, CouponUsage } from "@/types/admin";
import { publicProductId } from "@/server/catalog/mapper";
import { connectToDatabase } from "@/server/db/connect";
import { badRequest, conflict, notFound } from "@/server/http/errors";
import { Category } from "@/server/models/category.model";
import { Coupon } from "@/server/models/coupon.model";
import { CouponRedemption } from "@/server/models/coupon-redemption.model";
import { Offer } from "@/server/models/offer.model";
import { Order } from "@/server/models/order.model";
import { Product } from "@/server/models/product.model";
import type { couponCreateBody, couponListQuery, couponUpdateBody, couponUsageQuery, offerBody, offerUpdateBody } from "@/server/validation/admin-marketing";
import { couponFullCheck } from "@/server/validation/admin-marketing";
import { audit, type AuditActor } from "./audit.service";
import { escapeRegex, pageOf } from "./admin-sales.shared";
import { describeCoupon } from "./coupon.service";

/**
 * Admin coupons and announcement-bar offers. Checkout keeps validating every coupon on the server
 * (coupon.service); this only manages the definitions. Money is paise in the database and rupees
 * in the AdminCoupon shape the dashboard uses. Usage counts are never written from here.
 */

interface CouponLean {
  _id: Types.ObjectId;
  code: string;
  description?: string;
  type: "percent" | "flat";
  value: number;
  minOrderPaise?: number;
  maxDiscountPaise?: number | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  usageLimit?: number | null;
  perCustomerLimit?: number | null;
  usageCount?: number;
  active?: boolean;
  listed?: boolean;
  products?: Types.ObjectId[];
  categories?: Types.ObjectId[];
  excludedProducts?: Types.ObjectId[];
  excludedCategories?: Types.ObjectId[];
}

/* ---------- Reference lookups (public IDs ↔ database IDs) ---------- */

async function productIds(refs: string[]) {
  if (!refs.length) return [];
  const docs = await Product.find({ $or: [{ legacyId: { $in: refs } }, { _id: { $in: refs.filter(isValidObjectId).map((r) => new Types.ObjectId(r)) } }] }, { _id: 1, legacyId: 1 }).lean();
  const found = new Set(docs.flatMap((d) => [String(d._id), d.legacyId].filter(Boolean)));
  const missing = refs.filter((r) => !found.has(r));
  if (missing.length) throw badRequest(`Unknown product: ${missing[0]}.`);
  return docs.map((d) => d._id);
}

async function categoryIds(slugs: string[]) {
  if (!slugs.length) return [];
  const docs = await Category.find({ slug: { $in: slugs } }, { _id: 1, slug: 1 }).lean();
  const missing = slugs.filter((s) => !docs.some((d) => d.slug === s));
  if (missing.length) throw badRequest(`Unknown category: ${missing[0]}.`);
  return docs.map((d) => d._id);
}

async function refMaps(coupons: CouponLean[]) {
  const pIds = [...new Set(coupons.flatMap((c) => [...(c.products ?? []), ...(c.excludedProducts ?? [])].map(String)))];
  const cIds = [...new Set(coupons.flatMap((c) => [...(c.categories ?? []), ...(c.excludedCategories ?? [])].map(String)))];
  const [ps, cs] = await Promise.all([
    pIds.length ? Product.find({ _id: { $in: pIds } }, { _id: 1, legacyId: 1 }).lean() : [],
    cIds.length ? Category.find({ _id: { $in: cIds } }, { _id: 1, slug: 1 }).lean() : [],
  ]);
  return {
    product: new Map(ps.map((p) => [String(p._id), publicProductId(p as never)])),
    category: new Map(cs.map((c) => [String(c._id), c.slug as string])),
  };
}

function toAdminCoupon(c: CouponLean, maps: Awaited<ReturnType<typeof refMaps>>): AdminCoupon {
  const rupees = (p?: number | null) => (p == null ? undefined : p / 100);
  const ids = (list: Types.ObjectId[] | undefined, map: Map<string, string>) => (list ?? []).map((x) => map.get(String(x))).filter((x): x is string => !!x);
  return {
    id: String(c._id),
    code: c.code,
    type: c.type,
    value: c.type === "flat" ? c.value / 100 : c.value,
    minOrder: (c.minOrderPaise ?? 0) / 100,
    maxDiscount: rupees(c.maxDiscountPaise),
    description: describeCoupon(c),
    active: c.active !== false,
    listed: c.listed !== false,
    usageCount: c.usageCount ?? 0,
    usageLimit: c.usageLimit ?? null,
    perCustomerLimit: c.perCustomerLimit ?? null,
    startsAt: (c.startsAt ?? new Date(0)).toISOString(),
    endsAt: c.endsAt ? c.endsAt.toISOString() : null,
    products: ids(c.products, maps.product),
    categories: ids(c.categories, maps.category),
    excludedProducts: ids(c.excludedProducts, maps.product),
    excludedCategories: ids(c.excludedCategories, maps.category),
  };
}

/* ---------- Coupons ---------- */

function stateFilter(state: z.output<typeof couponListQuery>["state"], now = new Date()) {
  switch (state) {
    case "disabled":
      return { active: false };
    case "scheduled":
      return { active: { $ne: false }, startsAt: { $gt: now } };
    case "expired":
      return { active: { $ne: false }, endsAt: { $ne: null, $lte: now } };
    case "used_up":
      return { active: { $ne: false }, usageLimit: { $ne: null }, $expr: { $gte: ["$usageCount", "$usageLimit"] } };
    case "live":
      return {
        active: { $ne: false },
        $and: [
          { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
          { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] },
          { $or: [{ usageLimit: null }, { $expr: { $lt: ["$usageCount", "$usageLimit"] } }] },
        ],
      };
    default:
      return {};
  }
}

export async function listCoupons(q: z.output<typeof couponListQuery>) {
  await connectToDatabase();
  const filter: Record<string, unknown> = { ...stateFilter(q.state) };
  if (q.q) filter.code = { $regex: escapeRegex(q.q.toUpperCase()) };
  const [docs, total, totals, live] = await Promise.all([
    Coupon.find(filter).sort({ createdAt: -1, _id: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean<CouponLean[]>(),
    Coupon.countDocuments(filter),
    Coupon.aggregate<{ all: number; redemptions: number }>([{ $group: { _id: null, all: { $sum: 1 }, redemptions: { $sum: "$usageCount" } } }]),
    Coupon.countDocuments(stateFilter("live")),
  ]);
  const maps = await refMaps(docs);
  return { ...pageOf(docs.map((d) => toAdminCoupon(d, maps)), q.page, q.limit, total), summary: { all: totals[0]?.all ?? 0, live, redemptions: totals[0]?.redemptions ?? 0 } };
}

async function getCoupon(id: string) {
  const c = await Coupon.findById(id).lean<CouponLean>();
  if (!c) throw notFound("Coupon not found.");
  return toAdminCoupon(c, await refMaps([c]));
}

async function toDoc(input: Partial<z.output<typeof couponCreateBody>>) {
  const doc: Record<string, unknown> = {};
  for (const k of ["code", "description", "type", "value", "minOrderPaise", "maxDiscountPaise", "startsAt", "endsAt", "usageLimit", "perCustomerLimit", "active", "listed"] as const) {
    if (input[k] !== undefined) doc[k] = input[k];
  }
  if (input.products) doc.products = await productIds(input.products);
  if (input.excludedProducts) doc.excludedProducts = await productIds(input.excludedProducts);
  if (input.categories) doc.categories = await categoryIds(input.categories);
  if (input.excludedCategories) doc.excludedCategories = await categoryIds(input.excludedCategories);
  if (input.type === "flat") doc.maxDiscountPaise = null;
  return doc;
}

const duplicate = (err: unknown) => (err as { code?: number }).code === 11000;

export async function createCoupon(input: z.output<typeof couponCreateBody>, actor: AuditActor) {
  await connectToDatabase();
  try {
    const c = await Coupon.create({ ...(await toDoc(input)), usageCount: 0 });
    await audit(actor, "coupon.create", { type: "coupon", id: String(c._id), label: input.code }, { type: input.type, value: input.value, active: input.active });
    return getCoupon(String(c._id));
  } catch (err) {
    if (duplicate(err)) throw conflict(`A coupon with the code ${input.code} already exists.`);
    throw err;
  }
}

export async function updateCoupon(id: string, input: z.output<typeof couponUpdateBody>, actor: AuditActor) {
  await connectToDatabase();
  const before = await Coupon.findById(id).lean<CouponLean>();
  if (!before) throw notFound("Coupon not found.");
  // Re-check the coupon as a whole (e.g. a new end date against the existing start date).
  const merged = couponFullCheck.safeParse({
    code: before.code,
    description: before.description ?? "",
    type: before.type,
    value: before.value,
    minOrderPaise: before.minOrderPaise ?? 0,
    maxDiscountPaise: before.maxDiscountPaise ?? null,
    startsAt: before.startsAt ?? new Date(0),
    endsAt: before.endsAt ?? null,
    usageLimit: before.usageLimit ?? null,
    perCustomerLimit: before.perCustomerLimit ?? null,
    active: before.active !== false,
    listed: before.listed !== false,
    ...input,
    ...(input.type === "flat" ? { maxDiscountPaise: null } : {}),
  });
  if (!merged.success) throw badRequest(merged.error.issues[0]?.message ?? "Invalid coupon.");
  const used = (before.usageCount ?? 0) > 0 || !!(await CouponRedemption.exists({ coupon: before._id }));
  if (input.code && input.code !== before.code && used) throw conflict("This coupon has already been used, so its code can't change. Create a new coupon instead.");
  if (input.usageLimit != null && input.usageLimit < (before.usageCount ?? 0)) {
    throw badRequest(`It has already been used ${before.usageCount} times — the limit can't be lower than that.`);
  }
  const set = await toDoc(input);
  try {
    // usageCount is deliberately never part of $set.
    await Coupon.updateOne({ _id: before._id }, { $set: set }, { runValidators: true });
  } catch (err) {
    if (duplicate(err)) throw conflict(`A coupon with the code ${input.code} already exists.`);
    throw err;
  }
  const changes = Object.fromEntries(
    Object.keys(set).map((k) => [k, { from: (before as unknown as Record<string, unknown>)[k] ?? null, to: set[k] ?? null }]),
  );
  await audit(actor, input.active !== undefined && Object.keys(set).length === 1 ? (input.active ? "coupon.enable" : "coupon.disable") : "coupon.update", { type: "coupon", id, label: before.code }, changes);
  return getCoupon(id);
}

/** Deletes a coupon that was never used. Used coupons stay (orders reference them) — disable them instead. */
export async function deleteCoupon(id: string, actor: AuditActor) {
  await connectToDatabase();
  const c = await Coupon.findById(id).lean<CouponLean>();
  if (!c) throw notFound("Coupon not found.");
  const used =
    (c.usageCount ?? 0) > 0 ||
    !!(await CouponRedemption.exists({ coupon: c._id })) ||
    !!(await Order.exists({ $or: [{ "coupon.coupon": c._id }, { "coupon.code": c.code }] }));
  if (used) throw conflict(`${c.code} has been used on orders, so it can't be deleted. Disable it instead — past orders keep their discount.`);
  const res = await Coupon.deleteOne({ _id: c._id, usageCount: { $in: [0, null] } });
  if (!res.deletedCount) throw conflict(`${c.code} was just used, so it can't be deleted. Disable it instead.`);
  await audit(actor, "coupon.delete", { type: "coupon", id, label: c.code });
  return { deleted: true };
}

export async function couponUsage(id: string, q: z.output<typeof couponUsageQuery>) {
  await connectToDatabase();
  if (!(await Coupon.exists({ _id: id }))) throw notFound("Coupon not found.");
  const filter = { coupon: new Types.ObjectId(id) };
  const [rows, total] = await Promise.all([
    CouponRedemption.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
    CouponRedemption.countDocuments(filter),
  ]);
  const orders = await Order.find({ _id: { $in: rows.map((r) => r.order) } }, { orderNumber: 1, "customer.fullName": 1 }).lean<{ _id: Types.ObjectId; orderNumber: string; customer?: { fullName?: string } }[]>();
  const byId = new Map(orders.map((o) => [String(o._id), o]));
  const items: CouponUsage[] = rows.map((r) => ({
    orderId: byId.get(String(r.order))?.orderNumber ?? "",
    customer: byId.get(String(r.order))?.customer?.fullName ?? "",
    email: r.email,
    discount: r.discountPaise / 100,
    status: r.status as CouponUsage["status"],
    at: new Date(r.createdAt as Date).toISOString(),
  }));
  return pageOf(items, q.page, q.limit, total);
}

/* ---------- Offers ---------- */

interface OfferLean {
  _id: Types.ObjectId;
  title: string;
  subtitle?: string;
  code?: string | null;
  href?: string;
  active?: boolean;
  sortOrder?: number;
}

const toOffer = (o: OfferLean): AdminOffer & { sortOrder: number } => ({
  id: String(o._id),
  title: o.title,
  subtitle: o.subtitle ?? "",
  code: o.code ?? undefined,
  href: o.href ?? "/shop",
  active: o.active !== false,
  sortOrder: o.sortOrder ?? 0,
});

export async function listOffers() {
  await connectToDatabase();
  return (await Offer.find({}).sort({ sortOrder: 1, createdAt: 1 }).lean<OfferLean[]>()).map(toOffer);
}

export async function createOffer(input: z.output<typeof offerBody>, actor: AuditActor) {
  await connectToDatabase();
  const last = await Offer.findOne({}, { sortOrder: 1 }).sort({ sortOrder: -1 }).lean<OfferLean>();
  const o = await Offer.create({ ...input, sortOrder: input.sortOrder ?? (last?.sortOrder ?? -1) + 1 });
  await audit(actor, "offer.create", { type: "offer", id: String(o._id), label: input.title });
  return toOffer(o.toObject() as unknown as OfferLean);
}

export async function updateOffer(id: string, input: z.output<typeof offerUpdateBody>, actor: AuditActor) {
  await connectToDatabase();
  const o = await Offer.findByIdAndUpdate(id, { $set: input }, { returnDocument: "after", runValidators: true }).lean<OfferLean>();
  if (!o) throw notFound("Offer not found.");
  await audit(actor, "offer.update", { type: "offer", id, label: o.title }, input);
  return toOffer(o);
}

export async function deleteOffer(id: string, actor: AuditActor) {
  await connectToDatabase();
  const o = await Offer.findByIdAndDelete(id).lean<OfferLean>();
  if (!o) throw notFound("Offer not found.");
  await audit(actor, "offer.delete", { type: "offer", id, label: o.title });
  return { deleted: true };
}
