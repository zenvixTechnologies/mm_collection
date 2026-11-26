import "server-only";
import { revalidateTag, unstable_cache } from "next/cache";
import type { StorefrontBanner } from "@/types";
import { connectToDatabase } from "@/server/db/connect";
import { HomepageBanner } from "@/server/models/homepage-banner.model";
import { logger, serializeError } from "@/server/utils/logger";

/**
 * Storefront reads of homepage content managed in the admin. Cached (tag "homepage", 60 s so
 * scheduled banners start and stop on time) and refreshed immediately after admin changes.
 */

export const HOMEPAGE_TAG = "homepage";

interface BannerLean {
  placement: "hero" | "promo";
  eyebrow?: string;
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  ctaHref?: string;
  image?: { url?: string } | null;
}

/** The first eligible banner of each placement: active, inside its dates, with an image. */
export async function loadStorefrontBanners(now = new Date()): Promise<{ hero: StorefrontBanner | null; promo: StorefrontBanner | null }> {
  try {
    await connectToDatabase();
    const docs = await HomepageBanner.find({
      active: true,
      "image.url": { $type: "string" },
      $and: [{ $or: [{ startsAt: null }, { startsAt: { $lte: now } }] }, { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] }],
    })
      .sort({ placement: 1, sortOrder: 1, createdAt: 1 })
      .lean<BannerLean[]>();
    const pick = (placement: "hero" | "promo") => {
      const b = docs.find((d) => d.placement === placement);
      return b
        ? { eyebrow: b.eyebrow ?? "", title: b.title, subtitle: b.subtitle ?? "", ctaLabel: b.ctaLabel || "Shop Now", ctaHref: b.ctaHref || "/shop", image: b.image!.url! }
        : null;
    };
    return { hero: pick("hero"), promo: pick("promo") };
  } catch (err) {
    // The homepage must never fail because of banners — it falls back to its built-in content.
    logger.warn("homepage.banners_unavailable", { error: serializeError(err) });
    return { hero: null, promo: null };
  }
}

export const getStorefrontBanners = unstable_cache(() => loadStorefrontBanners(), ["storefront-banners-v1"], { revalidate: 60, tags: [HOMEPAGE_TAG] });

export function refreshHomepage() {
  try {
    revalidateTag(HOMEPAGE_TAG);
  } catch (err) {
    logger.debug("homepage.revalidate_skipped", { error: serializeError(err) });
  }
}
