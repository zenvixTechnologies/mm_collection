"use client";

import type { AdminImage } from "@/types/admin";
import { AdminApiError, adminApi } from "./admin-api";

/**
 * Direct browser → Cloudinary uploads, authorised by a one-time signature from our API.
 * The Cloudinary API secret never reaches the browser.
 */

export type UploadPurpose = "product" | "category" | "banner" | "logo";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];

/** URL → Cloudinary details for images uploaded in this tab, so saves can record the public ID. */
const registry = new Map<string, AdminImage>();

export function rememberImages(images: AdminImage[] | undefined) {
  for (const img of images ?? []) if (img.url) registry.set(img.url, img);
}

/** Full image details for URLs shown in the admin (falls back to a bare URL for older images). */
export function imageDetails(urls: string[], alt: string): AdminImage[] {
  return urls.map((url) => ({ ...(registry.get(url) ?? { url }), alt: registry.get(url)?.alt || alt }));
}

export function checkFile(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) return `${file.name}: use a JPG, PNG, WebP or AVIF image.`;
  if (file.size > MAX_UPLOAD_BYTES) return `${file.name} is larger than 5 MB.`;
  return null;
}

interface Signed {
  uploadUrl: string;
  fields: Record<string, string>;
  publicId: string;
}

export async function uploadImage(file: File, purpose: UploadPurpose, ref?: string): Promise<AdminImage> {
  const problem = checkFile(file);
  if (problem) throw new AdminApiError(problem, 400, "VALIDATION_ERROR");

  const { data: signed } = await adminApi<Signed>("/uploads/sign", { method: "POST", body: { purpose, ref } });

  const form = new FormData();
  form.append("file", file);
  for (const [k, v] of Object.entries(signed.fields)) form.append(k, v);
  let res: Response;
  try {
    res = await fetch(signed.uploadUrl, { method: "POST", body: form });
  } catch {
    throw new AdminApiError("Upload failed — check your connection and try again.", 0, "NETWORK_ERROR");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new AdminApiError(body?.error?.message ? `Upload rejected: ${body.error.message}` : "Upload failed. Please try again.", res.status, "BAD_REQUEST");
  }

  // The server re-checks format and size with Cloudinary and returns the trusted URL.
  const { data } = await adminApi<{ url: string; publicId: string; width: number; height: number }>("/uploads/confirm", {
    method: "POST",
    body: { publicId: signed.publicId },
  });
  const image: AdminImage = { url: data.url, publicId: data.publicId, width: data.width, height: data.height };
  registry.set(image.url, image);
  return image;
}
