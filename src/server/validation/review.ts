import "server-only";
import { z } from "zod";
import { MAX_REVIEW_IMAGE_BYTES, MAX_REVIEW_IMAGES, REVIEW_IMAGE_TYPES } from "@/lib/reviews";
import { objectId, pagination } from "./common";

export const reviewProductParams = z.object({ ref: z.string().trim().min(1).max(120) });

/**
 * Unknown fields (user, order, "verified", image URLs…) are dropped: the server decides all of
 * those. Photos are named only by the IDs this server issued after checking them.
 */
export const orderReviewBody = z.object({
  productId: objectId,
  rating: z.number({ error: "Choose a rating." }).int("Choose a rating from 1 to 5.").min(1, "Choose a rating from 1 to 5.").max(5, "Choose a rating from 1 to 5."),
  comment: z.string({ error: "Write your review." }).trim().min(10, "Please write at least 10 characters.").max(2000, "Keep your review under 2,000 characters."),
  imageIds: z
    .array(objectId)
    .max(MAX_REVIEW_IMAGES, `Add up to ${MAX_REVIEW_IMAGES} photos.`)
    .refine((ids) => new Set(ids).size === ids.length, "Each photo can only be added once.")
    .default([]),
});

/** What the browser says about the file — an early check only; Cloudinary's record is what counts. */
export const reviewUploadSignBody = z.object({
  productId: objectId,
  contentType: z.enum(REVIEW_IMAGE_TYPES, { error: "Only JPG, PNG or WebP images are allowed." }),
  size: z.number().int().positive("That file is empty.").max(MAX_REVIEW_IMAGE_BYTES, "Images must be 5 MB or smaller."),
});

export const reviewUploadConfirmBody = z.object({ productId: objectId, uploadId: objectId });

export const reviewListQuery = pagination.pick({ page: true });

export const adminReviewListQuery = pagination.extend({
  q: z.string().trim().max(100).optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
});

export const adminReviewParams = z.object({ id: objectId });
