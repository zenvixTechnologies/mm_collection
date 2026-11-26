import "server-only";
import { isValidObjectId, Types } from "mongoose";
import type { z } from "zod";
import type { HomepageBanner as AdminBanner, HomepageSection } from "@/types/admin";
import { publicProductId } from "@/server/catalog/mapper";
import { connectToDatabase } from "@/server/db/connect";
import { withTransaction } from "@/server/db/transaction";
import { badRequest, notFound } from "@/server/http/errors";
import { HomepageBanner } from "@/server/models/homepage-banner.model";
import { MediaAsset } from "@/server/models/media-asset.model";
import { Product } from "@/server/models/product.model";
import { StoreSettings } from "@/server/models/store-settings.model";
import type { bannerCreateBody, bannerUpdateBody, featuredBody, sectionBody } from "@/server/validation/admin-marketing";
import { bannerCreateBody as bannerFullCheck } from "@/server/validation/admin-marketing";
import { audit, type AuditActor } from "./audit.service";
import { refreshHomepage } from "./homepage.service";
import { cleanupImages } from "./media.service";

/**
 * Admin homepage: hero/promo banners (Cloudinary images via the existing signed-upload flow),
 * featured products and section visibility (in the store settings document).
 */

interface BannerLean {
  _id: Types.ObjectId;
  placement: "hero" | "promo";
  eyebrow?: string;
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  ctaHref?: string;
  image?: { url: string; publicId?: string | null; width?: number | null; height?: number | null } | null;
  active?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
  sortOrder?: number;
}

const toBanner = (b: BannerLean): AdminBanner => ({
  id: String(b._id),
  placement: b.placement,
  eyebrow: b.eyebrow ?? "",
  title: b.title,
  subtitle: b.subtitle ?? "",
  ctaLabel: b.ctaLabel ?? "",
  ctaHref: b.ctaHref ?? "/shop",
  image: b.image?.url ?? "",
  imagePublicId: b.image?.publicId ?? null,
  active: b.active !== false,
  startsAt: b.startsAt ? b.startsAt.toISOString() : null,
  endsAt: b.endsAt ? b.endsAt.toISOString() : null,
  sortOrder: b.sortOrder ?? 0,
});

/** Section list used when a store has no saved settings yet. */
export const DEFAULT_SECTIONS: HomepageSection[] = [
  { id: "audience", label: "Shop by audience", description: "Women · Men · Kids · Home & Living selector cards", visible: true },
  { id: "categories", label: "Category grid", description: "Popular categories with photos", visible: true },
  { id: "featured", label: "Featured collections", description: "The featured products you pick below", visible: true },
  { id: "promo", label: "Promotional banner", description: "Active promo banners", visible: true },
  { id: "why", label: "Why choose us", description: "Brand promises and trust points", visible: true },
  { id: "testimonials", label: "Testimonials", description: "Customer reviews carousel", visible: true },
  { id: "newsletter", label: "Newsletter sign-up", description: "Email capture at the bottom of the page", visible: false },
];

/** The single settings document, created with defaults if it doesn't exist yet. */
export async function settingsDoc() {
  await connectToDatabase();
  // Read first: an upsert on an existing document would still bump `updatedAt` (Mongoose
  // timestamps), which is the settings "version" used to detect concurrent edits.
  const existing = await StoreSettings.findOne({ key: "store" }).lean();
  if (existing) return existing;
  return StoreSettings.findOneAndUpdate(
    { key: "store" },
    { $setOnInsert: { key: "store", "homepage.sections": DEFAULT_SECTIONS.map((s) => ({ key: s.id, label: s.label, description: s.description, visible: s.visible })) } },
    { upsert: true, returnDocument: "after" },
  ).lean();
}

/* ---------- Read ---------- */

export async function getHomepageAdmin() {
  await connectToDatabase();
  const [banners, settings] = await Promise.all([HomepageBanner.find({}).sort({ placement: 1, sortOrder: 1, createdAt: 1 }).lean<BannerLean[]>(), settingsDoc()]);
  const featuredIds = (settings?.homepage?.featuredProducts ?? []) as Types.ObjectId[];
  const products = featuredIds.length ? await Product.find({ _id: { $in: featuredIds } }, { _id: 1, legacyId: 1 }).lean() : [];
  const publicIdOf = new Map(products.map((p) => [String(p._id), publicProductId(p as never)]));
  const saved = settings?.homepage?.sections ?? [];
  return {
    banners: banners.map(toBanner),
    featuredProductIds: featuredIds.map((id) => publicIdOf.get(String(id))).filter((x): x is string => !!x),
    sections: DEFAULT_SECTIONS.map((d) => {
      const s = saved.find((x: { key: string }) => x.key === d.id) as { visible?: boolean } | undefined;
      return { ...d, visible: s ? s.visible !== false : d.visible };
    }),
  };
}

/* ---------- Banners ---------- */

/**
 * An image may be (a) one uploaded through the admin and confirmed with Cloudinary (its MediaAsset
 * matches) or (b) the image the banner already has. Arbitrary URLs are refused.
 */
async function checkedImage(image: z.output<typeof bannerCreateBody>["image"], current?: BannerLean["image"]) {
  if (current?.url && image.url === current.url) return current;
  if (!image.publicId) throw badRequest("Upload the banner image through the admin panel.");
  const asset = await MediaAsset.findOne({ publicId: image.publicId, status: { $in: ["uploaded", "attached"] } }).lean();
  if (!asset || asset.url !== image.url) throw badRequest("This image wasn't uploaded through the admin panel. Please upload it again.");
  return { url: asset.url as string, publicId: asset.publicId as string, width: (asset.width as number | null) ?? null, height: (asset.height as number | null) ?? null };
}

export async function createBanner(input: z.output<typeof bannerCreateBody>, actor: AuditActor) {
  await connectToDatabase();
  const image = await checkedImage(input.image);
  const last = await HomepageBanner.findOne({ placement: input.placement }, { sortOrder: 1 }).sort({ sortOrder: -1 }).lean<BannerLean>();
  const b = await HomepageBanner.create({ ...input, image, sortOrder: (last?.sortOrder ?? -1) + 1 });
  await MediaAsset.updateOne({ publicId: image.publicId }, { $set: { status: "attached" } });
  await audit(actor, "banner.create", { type: "banner", id: String(b._id), label: input.title }, { placement: input.placement, active: input.active });
  refreshHomepage();
  return toBanner(b.toObject() as unknown as BannerLean);
}

export async function updateBanner(id: string, input: z.output<typeof bannerUpdateBody>, actor: AuditActor) {
  await connectToDatabase();
  const before = await HomepageBanner.findById(id).lean<BannerLean>();
  if (!before) throw notFound("Banner not found.");
  // Check the banner as a whole (e.g. new end date vs existing start date).
  const merged = bannerFullCheck.safeParse({
    placement: before.placement,
    eyebrow: before.eyebrow ?? "",
    title: before.title,
    subtitle: before.subtitle ?? "",
    ctaLabel: before.ctaLabel ?? "",
    ctaHref: before.ctaHref ?? "/shop",
    image: before.image ?? { url: "https://invalid.local" },
    active: before.active !== false,
    startsAt: before.startsAt ?? null,
    endsAt: before.endsAt ?? null,
    ...input,
  });
  if (!merged.success) throw badRequest(merged.error.issues[0]?.message ?? "Invalid banner.");
  const set: Record<string, unknown> = { ...input };
  if (input.image) set.image = await checkedImage(input.image, before.image);
  if (input.placement && input.placement !== before.placement) {
    const last = await HomepageBanner.findOne({ placement: input.placement }, { sortOrder: 1 }).sort({ sortOrder: -1 }).lean<BannerLean>();
    set.sortOrder = (last?.sortOrder ?? -1) + 1;
  }
  const after = await HomepageBanner.findByIdAndUpdate(id, { $set: set }, { returnDocument: "after", runValidators: true }).lean<BannerLean>();
  if (!after) throw notFound("Banner not found.");
  const replaced = before.image?.publicId && before.image.publicId !== after.image?.publicId ? before.image.publicId : null;
  if (after.image?.publicId) await MediaAsset.updateOne({ publicId: after.image.publicId }, { $set: { status: "attached" } });
  await cleanupImages([replaced]);
  await audit(actor, input.active !== undefined && Object.keys(input).length === 1 ? (input.active ? "banner.activate" : "banner.deactivate") : "banner.update", { type: "banner", id, label: after.title }, {
    fields: Object.keys(input),
    imageReplaced: !!replaced,
  });
  refreshHomepage();
  return toBanner(after);
}

export async function deleteBanner(id: string, actor: AuditActor) {
  await connectToDatabase();
  const b = await HomepageBanner.findByIdAndDelete(id).lean<BannerLean>();
  if (!b) throw notFound("Banner not found.");
  await cleanupImages([b.image?.publicId]);
  await audit(actor, "banner.delete", { type: "banner", id, label: b.title });
  refreshHomepage();
  return { deleted: true };
}

/** Swaps a banner with its neighbour in the same placement (display order). */
export async function moveBanner(id: string, direction: -1 | 1, actor: AuditActor) {
  await withTransaction(async (session) => {
    const b = await HomepageBanner.findById(id).session(session).lean<BannerLean>();
    if (!b) throw notFound("Banner not found.");
    const list = await HomepageBanner.find({ placement: b.placement }).sort({ sortOrder: 1, createdAt: 1 }).session(session).lean<BannerLean[]>();
    const i = list.findIndex((x) => String(x._id) === id);
    const j = i + direction;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    for (let k = 0; k < list.length; k++) await HomepageBanner.updateOne({ _id: list[k]._id }, { $set: { sortOrder: k } }, { session });
  });
  await audit(actor, "banner.reorder", { type: "banner", id }, { direction });
  refreshHomepage();
  return getHomepageAdmin();
}

/* ---------- Featured products & sections ---------- */

export async function setFeaturedProducts(input: z.output<typeof featuredBody>, actor: AuditActor) {
  await connectToDatabase();
  const refs = input.productIds;
  const docs = refs.length
    ? await Product.find({ $or: [{ legacyId: { $in: refs } }, { _id: { $in: refs.filter(isValidObjectId).map((r) => new Types.ObjectId(r)) } }] }, { _id: 1, legacyId: 1, status: 1 }).lean()
    : [];
  const byRef = new Map(docs.flatMap((d) => [[String(d._id), d], ...(d.legacyId ? [[d.legacyId, d] as const] : [])]));
  const ordered = refs.map((r) => byRef.get(r));
  const missing = refs.find((_, i) => !ordered[i]);
  if (missing) throw badRequest(`Unknown product: ${missing}.`);
  if (ordered.some((d) => d!.status !== "active")) throw badRequest("Only active products can be featured.");
  await settingsDoc();
  await StoreSettings.updateOne({ key: "store" }, { $set: { "homepage.featuredProducts": ordered.map((d) => d!._id) } });
  await audit(actor, "homepage.featured", { type: "settings", id: "homepage" }, { count: refs.length });
  refreshHomepage();
  return getHomepageAdmin();
}

export async function setSectionVisibility(input: z.output<typeof sectionBody>, actor: AuditActor) {
  const settings = await settingsDoc();
  const sections = DEFAULT_SECTIONS.map((d) => {
    const saved = (settings?.homepage?.sections ?? []).find((x: { key: string }) => x.key === d.id) as { visible?: boolean } | undefined;
    const visible = d.id === input.key ? input.visible : saved ? saved.visible !== false : d.visible;
    return { key: d.id, label: d.label, description: d.description, visible };
  });
  await StoreSettings.updateOne({ key: "store" }, { $set: { "homepage.sections": sections } });
  await audit(actor, "homepage.section", { type: "settings", id: "homepage", label: input.key }, { visible: input.visible });
  refreshHomepage();
  return getHomepageAdmin();
}
