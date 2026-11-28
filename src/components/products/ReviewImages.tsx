"use client";

import type { ReviewImage } from "@/types";
import { ProductImage } from "@/components/ui/ProductImage";

/** A review's photos as small thumbnails; each opens full size in a new tab. */
export function ReviewImages({ images, author }: { images: ReviewImage[]; author: string }) {
  if (!images.length) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-2">
      {images.map((image, i) => (
        <li key={image.url}>
          <a href={image.url} target="_blank" rel="noopener noreferrer" className="relative block h-20 w-20 overflow-hidden rounded-lg bg-sand" aria-label={`Open photo ${i + 1} from ${author}'s review`}>
            <ProductImage src={image.url} alt={`Photo ${i + 1} from ${author}'s review`} fill sizes="80px" />
          </a>
        </li>
      ))}
    </ul>
  );
}
