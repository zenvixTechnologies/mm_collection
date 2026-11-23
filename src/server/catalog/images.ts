import "server-only";
import { z } from "zod";

/**
 * Images may only come from our Cloudinary account or the original catalogue's Unsplash photos —
 * never an arbitrary URL (no hot-linking, tracking pixels or javascript: URLs).
 */
export function isAllowedImageUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.hostname === "images.unsplash.com") return true;
  const cloud = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  return url.hostname === "res.cloudinary.com" && !!cloud && url.pathname.startsWith(`/${cloud}/image/upload/`);
}

export const imageInput = z.object({
  url: z.string().trim().max(1000).refine(isAllowedImageUrl, "Images must be uploaded through the admin panel."),
  publicId: z.string().trim().max(300).regex(/^[\w\-/]+$/).nullish(),
  width: z.number().int().positive().max(20_000).nullish(),
  height: z.number().int().positive().max(20_000).nullish(),
  alt: z.string().trim().max(200).optional(),
});

export type ImageInput = z.output<typeof imageInput>;
