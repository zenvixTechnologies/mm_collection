import type { Product } from "@/types";

/**
 * Which photos to show for a colour. A colour's own gallery is used when it has one; otherwise the
 * product's general photos are shown — and labelled as such, never as that colour's photos.
 */

/** The most photos one colour can have. */
export const MAX_COLOR_IMAGES = 6;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

type Pictured = Pick<Product, "images" | "colors" | "colorImages">;

export const colorGallery = (product: Pick<Product, "colorImages">, color: string) => product.colorImages?.find((g) => same(g.color, color))?.images ?? [];

export interface Gallery {
  images: string[];
  /** "color" = the chosen colour's own photos; "general" = the product's shared photos. */
  source: "color" | "general";
  /** Set when the shared photos stand in for a colour that has none of its own. */
  notice: string | null;
}

export function galleryFor(product: Pictured, color: string | null): Gallery {
  const own = color ? colorGallery(product, color) : [];
  if (own.length) return { images: own, source: "color", notice: null };
  // With a single colour and no colour galleries at all, the shared photos can't be of another colour.
  const couldMislead = !!color && (product.colors.length > 1 || !!product.colorImages?.length);
  return {
    images: product.images,
    source: "general",
    notice: couldMislead ? `No photos of ${color} yet. These are general product photos and may show another colour.` : null,
  };
}

/** Colours that have no photos of their own. */
export const colorsWithoutPhotos = (product: Pick<Product, "colors" | "colorImages">) => product.colors.map((c) => c.name).filter((name) => !colorGallery(product, name).length);
