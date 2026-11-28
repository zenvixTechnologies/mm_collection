import "server-only";
import { randomBytes } from "node:crypto";
import { Types } from "mongoose";
import { MAX_REVIEW_IMAGE_BYTES, REVIEW_IMAGE_FORMATS } from "@/lib/reviews";
import { connectToDatabase } from "@/server/db/connect";
import { AppError, badRequest, tooManyRequests } from "@/server/http/errors";
import { ROOT_FOLDER, cloudinaryConfig, copyImage, destroyImage, getResource, signParams, type CloudinaryResource } from "@/server/integrations/cloudinary/client";
import { MediaAsset } from "@/server/models/media-asset.model";
import { logger, serializeError } from "@/server/utils/logger";
import { assertCanReview } from "./review.service";

/**
 * Customer review photos. The browser uploads straight to Cloudinary with a one-time signature,
 * into a temporary ID. The server then checks that file with Cloudinary itself and makes its own
 * copy with all metadata (including GPS position) removed, and deletes the temporary one. Only
 * that server-made copy can be attached to a review; the browser is never able to upload to its
 * ID, so it can't be swapped after the check. IDs are random: nothing about the customer or order.
 */

const UPLOAD_FOLDER = `${ROOT_FOLDER}/review-uploads`;
const IMAGE_FOLDER = `${ROOT_FOLDER}/reviews`;
/** Upload attempts per customer and product in a day, so signatures can't be farmed. */
const DAILY_UPLOADS = 12;
const BAD_FORMAT = "Only JPG, PNG or WebP images are allowed.";
const TOO_BIG = "Images must be 5 MB or smaller.";

const newId = (folder: string) => `${folder}/${Date.now().toString(36)}-${randomBytes(12).toString("hex")}`;

const problemWith = (r: CloudinaryResource) =>
  r.resource_type !== "image" || r.type !== "upload" || !(REVIEW_IMAGE_FORMATS as readonly string[]).includes(r.format)
    ? BAD_FORMAT
    : !(r.bytes > 0) || r.bytes > MAX_REVIEW_IMAGE_BYTES
      ? TOO_BIG
      : null;

export async function signReviewUpload(userId: string, orderNumber: string, productId: string) {
  await assertCanReview(userId, orderNumber, productId);
  const { cloudName, apiKey, apiSecret } = cloudinaryConfig();
  const recent = await MediaAsset.countDocuments({
    purpose: "review",
    customer: userId,
    product: productId,
    publicId: { $regex: `^${UPLOAD_FOLDER}/` },
    createdAt: { $gt: new Date(Date.now() - 86_400_000) },
  });
  if (recent >= DAILY_UPLOADS) throw tooManyRequests(3600, "You've reached the photo upload limit for this product. Please try again tomorrow.");

  const publicId = newId(UPLOAD_FOLDER);
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { allowed_formats: REVIEW_IMAGE_FORMATS.join(","), overwrite: "false", public_id: publicId, timestamp };
  const asset = await MediaAsset.create({ publicId, purpose: "review", status: "signed", customer: userId, product: productId });
  return {
    uploadId: String(asset._id),
    uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,
    fields: { ...params, timestamp: String(timestamp), api_key: apiKey, signature: signParams(params, apiSecret) },
  };
}

export async function confirmReviewUpload(userId: string, orderNumber: string, productId: string, uploadId: string) {
  await assertCanReview(userId, orderNumber, productId);
  await connectToDatabase();
  // Claimed atomically: one upload yields at most one image, and only for who started it.
  const upload = await MediaAsset.findOneAndUpdate(
    { _id: uploadId, purpose: "review", customer: userId, product: productId, status: "signed", claimedAt: null, publicId: { $regex: `^${UPLOAD_FOLDER}/` } },
    { $set: { claimedAt: new Date() } },
    { returnDocument: "after" },
  ).lean();
  if (!upload) throw badRequest("That upload can't be used. Please add the photo again.");
  const release = () => MediaAsset.updateOne({ _id: upload._id }, { $set: { claimedAt: null } });

  let original: CloudinaryResource;
  try {
    original = await getResource(upload.publicId);
  } catch (err) {
    await release();
    if (err instanceof AppError && err.status === 404) throw badRequest("The photo didn't finish uploading. Please try again.");
    throw err;
  }
  const problem = problemWith(original);
  if (problem) {
    await destroyImage(upload.publicId).catch(() => undefined);
    await MediaAsset.updateOne({ _id: upload._id }, { $set: { status: "deleted", deletedAt: new Date() } });
    throw badRequest(problem);
  }

  // Recorded before the copy is made, so the cleanup job finds it whatever happens next.
  const image = await MediaAsset.create({ publicId: newId(IMAGE_FOLDER), purpose: "review", status: "signed", customer: userId, product: productId });
  let copy: CloudinaryResource;
  try {
    copy = await copyImage(original.secure_url, image.publicId);
    if (copy.public_id !== image.publicId || problemWith(copy)) throw new AppError(502, "SERVICE_UNAVAILABLE", "The image service is unavailable. Please try again.");
  } catch (err) {
    await release();
    throw err;
  }
  image.set({ status: "uploaded", url: copy.secure_url, format: copy.format, bytes: copy.bytes, width: copy.width, height: copy.height });
  await image.save();

  // The temporary record stays "signed": the cleanup job deletes that ID again later, which also
  // catches anything uploaded with the signature while it is still valid.
  await destroyImage(upload.publicId).catch((err: unknown) => logger.warn("review.upload_cleanup_failed", { publicId: upload.publicId, error: serializeError(err) }));
  return { id: String(image._id as Types.ObjectId), url: copy.secure_url, width: copy.width, height: copy.height };
}
