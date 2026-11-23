"use client";

import type { ImageLoaderProps } from "next/image";

/**
 * Custom loader for next/image. Unsplash's CDN (imgix) resizes and re-encodes
 * images on the fly, so we request exactly the width the browser needs.
 * Local images (e.g. the fallback placeholder) are returned untouched.
 */
export default function unsplashLoader({ src, width, quality }: ImageLoaderProps) {
  // Cloudinary (admin uploads): resize to the requested width, best format (AVIF/WebP) and quality.
  if (src.startsWith("https://res.cloudinary.com/") && src.includes("/image/upload/")) {
    const q = quality ? `q_${quality}` : "q_auto";
    return src.replace("/image/upload/", `/image/upload/f_auto,${q},c_limit,w_${width}/`);
  }
  if (!src.startsWith("https://images.unsplash.com")) return src;
  const url = new URL(src);
  url.searchParams.set("w", String(width));
  url.searchParams.set("q", String(quality ?? 72));
  url.searchParams.set("auto", "format");
  if (!url.searchParams.has("fit")) url.searchParams.set("fit", "crop");
  return url.toString();
}
