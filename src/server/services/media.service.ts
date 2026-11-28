import "server-only";
import { randomBytes } from "node:crypto";
import { isConfigured } from "@/server/config/env";
import { connectToDatabase } from "@/server/db/connect";
import { badRequest, forbidden } from "@/server/http/errors";
import {
  ALLOWED_FORMATS,
  MAX_IMAGE_BYTES,
  ROOT_FOLDER,
  cloudinaryConfig,
  destroyImage,
  getResource,
  signParams,
} from "@/server/integrations/cloudinary/client";
import { Category } from "@/server/models/category.model";
import { HomepageBanner } from "@/server/models/homepage-banner.model";
import { MediaAsset } from "@/server/models/media-asset.model";
import { Product } from "@/server/models/product.model";
import { Review } from "@/server/models/review.model";
import { logger, serializeError } from "@/server/utils/logger";
import { audit, type AuditActor } from "./audit.service";

export type UploadPurpose = "product" | "category" | "banner" | "logo";
// (Customer review photos have their own, stricter flow in review-image.service.ts.)

const FOLDERS: Record<UploadPurpose, string> = {
  product: "products",
  category: "categories",
  banner: "banners",
  logo: "brand",
};

/** Folder-safe segment, e.g. a product slug — keeps each product's images together. */
const segment = (s: string | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

/**
 * Signed parameters for ONE direct browser → Cloudinary upload. The signature fixes the exact
 * public ID (inside our folder), the allowed formats and no-overwrite, and expires after an hour,
 * so it can't be reused to upload anything else.
 */
export async function createUploadSignature(purpose: UploadPurpose, ref: string | undefined, actor: AuditActor) {
  const { cloudName, apiKey, apiSecret } = cloudinaryConfig();
  await connectToDatabase();
  const sub = purpose === "product" ? `/${segment(ref) || "unassigned"}` : "";
  const publicId = `${ROOT_FOLDER}/${FOLDERS[purpose]}${sub}/${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const params = {
    allowed_formats: ALLOWED_FORMATS.join(","),
    overwrite: "false",
    public_id: publicId,
    timestamp,
  };
  await MediaAsset.create({ publicId, purpose, status: "signed", uploadedBy: actor.adminId ?? null });
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,
    fields: { ...params, timestamp: String(timestamp), api_key: apiKey, signature: signParams(params, apiSecret) },
    publicId,
    maxBytes: MAX_IMAGE_BYTES,
    allowedFormats: [...ALLOWED_FORMATS],
  };
}

/**
 * Verifies an upload with Cloudinary itself (format, size, owner folder). Anything outside the
 * rules is deleted immediately. Returns the trusted URL and dimensions.
 */
export async function confirmUpload(publicId: string, actor: AuditActor) {
  await connectToDatabase();
  const asset = await MediaAsset.findOne({ publicId });
  if (!asset || asset.status === "deleted") throw forbidden("This upload wasn't started from the admin panel.");
  const r = await getResource(publicId);

  const problem = !(ALLOWED_FORMATS as readonly string[]).includes(r.format)
    ? "Only JPG, PNG, WebP or AVIF images are allowed."
    : r.bytes > MAX_IMAGE_BYTES
      ? "Images must be 5 MB or smaller."
      : null;
  if (problem) {
    await destroyImage(publicId).catch(() => undefined);
    asset.set({ status: "deleted", deletedAt: new Date() });
    await asset.save();
    throw badRequest(problem);
  }

  asset.set({ status: "uploaded", url: r.secure_url, format: r.format, bytes: r.bytes, width: r.width, height: r.height });
  await asset.save();
  await audit(actor, "media.upload", { type: "image", id: publicId }, { bytes: r.bytes, format: r.format });
  return { url: r.secure_url, publicId: r.public_id, width: r.width, height: r.height, format: r.format, bytes: r.bytes };
}

/** True if any product, category, banner or review still uses this image. */
async function isReferenced(publicId: string) {
  const [p, c, b, r] = await Promise.all([
    Product.exists({ "images.publicId": publicId }),
    Category.exists({ "image.publicId": publicId }),
    HomepageBanner.exists({ "image.publicId": publicId }),
    Review.exists({ "images.publicId": publicId }),
  ]);
  return Boolean(p || c || b || r);
}

/**
 * Deletes images that were replaced or removed — only once nothing references them any more.
 * Never throws: a failed delete leaves an orphan for the cleanup job, it must not fail the save.
 */
export async function cleanupImages(publicIds: (string | null | undefined)[]) {
  const ids = [...new Set(publicIds.filter((p): p is string => !!p && p.startsWith(`${ROOT_FOLDER}/`)))];
  if (!ids.length || !isConfigured("cloudinary")) return { deleted: 0 };
  await connectToDatabase();
  let deleted = 0;
  for (const id of ids) {
    try {
      if (await isReferenced(id)) continue;
      await destroyImage(id);
      await MediaAsset.updateOne({ publicId: id }, { $set: { status: "deleted", deletedAt: new Date() } });
      deleted++;
    } catch (err) {
      logger.warn("media.cleanup_failed", { publicId: id, error: serializeError(err) });
    }
  }
  return { deleted };
}

/**
 * Scheduled job: deletes uploads older than `olderThanHours` that never ended up on a product,
 * category or banner (abandoned forms, failed saves). Logos are kept — they live in settings.
 */
export async function cleanupOrphanImages(olderThanHours = 24, limit = 200) {
  await connectToDatabase();
  const cutoff = new Date(Date.now() - olderThanHours * 3600_000);
  const candidates = await MediaAsset.find({ status: { $in: ["signed", "uploaded"] }, purpose: { $ne: "logo" }, createdAt: { $lt: cutoff } })
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();
  let deleted = 0;
  let kept = 0;
  for (const a of candidates) {
    if (await isReferenced(a.publicId)) {
      await MediaAsset.updateOne({ _id: a._id }, { $set: { status: "attached" } });
      kept++;
      continue;
    }
    try {
      await destroyImage(a.publicId);
      await MediaAsset.updateOne({ _id: a._id }, { $set: { status: "deleted", deletedAt: new Date() } });
      deleted++;
    } catch (err) {
      logger.warn("media.orphan_cleanup_failed", { publicId: a.publicId, error: serializeError(err) });
    }
  }
  return { scanned: candidates.length, deleted, kept };
}
