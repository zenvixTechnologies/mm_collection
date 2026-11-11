"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { memo, useState } from "react";
import type { Product } from "@/types";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store/ui-store";
import { Price } from "@/components/ui/Price";
import { ProductImage } from "@/components/ui/ProductImage";
import { Rating } from "@/components/ui/Rating";
import { ProductBadges } from "./ProductBadges";
import { WishlistButton } from "./WishlistButton";

interface ProductCardProps {
  product: Product;
  priority?: boolean;
  showRating?: boolean;
}

export const ProductCard = memo(function ProductCard({ product, priority, showRating }: ProductCardProps) {
  const openQuickAdd = useUIStore((s) => s.openQuickAdd);
  // The close-up hover image is only fetched once a real mouse enters the card,
  // so touch devices never download it.
  const [altReady, setAltReady] = useState(false);
  const soldOut = product.stock <= 0;
  const href = `/product/${product.slug}`;
  const sizes = "(min-width: 1280px) 22vw, (min-width: 768px) 33vw, 50vw";
  const hasAlt = altReady && !!product.images[1];

  return (
    <article
      className="group relative flex flex-col"
      onPointerEnter={(e) => e.pointerType === "mouse" && !altReady && setAltReady(true)}
    >
      <div className="relative aspect-[4/5] overflow-hidden rounded-[var(--radius-card)] bg-sand">
        <div className="absolute inset-0">
          <ProductImage
            src={product.images[0]}
            alt={product.name}
            fill
            priority={priority}
            sizes={sizes}
            className={cn(
              "transition-[opacity,transform] duration-700 ease-out group-hover:scale-[1.04]",
              soldOut && "opacity-75 grayscale-[30%]",
              hasAlt && "group-hover:opacity-0",
            )}
          />
          {hasAlt && (
            <ProductImage
              src={product.images[1]}
              alt=""
              fill
              sizes={sizes}
              className="scale-[1.04] opacity-0 transition-opacity duration-700 ease-out group-hover:opacity-100"
            />
          )}
        </div>

        <ProductBadges product={product} className="pointer-events-none absolute top-2.5 left-2.5 z-10" />
        <WishlistButton productId={product.id} productName={product.name} className="absolute top-2.5 right-2.5 z-10" />

        {!soldOut && (
          <button
            type="button"
            onClick={() => openQuickAdd(product.id)}
            className="absolute right-2.5 bottom-2.5 z-10 flex h-9 items-center gap-1.5 rounded-full bg-white/95 px-3 text-[12.5px] font-semibold text-ink shadow-sm backdrop-blur transition-all duration-300 hover:bg-ink hover:text-white lg:right-3 lg:bottom-3 lg:left-3 lg:h-11 lg:justify-center lg:translate-y-3 lg:opacity-0 lg:group-focus-within:translate-y-0 lg:group-focus-within:opacity-100 lg:group-hover:translate-y-0 lg:group-hover:opacity-100"
            aria-label={`Quick add ${product.name} to bag`}
          >
            <Plus size={15} />
            <span className="hidden sm:inline">Quick Add</span>
            <span className="sm:hidden">Add</span>
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-1 flex-col px-0.5">
        <h3 className="line-clamp-1 text-[14.5px] leading-snug font-medium text-ink">
          <Link href={href} className="after:absolute after:inset-0 after:content-[''] focus:outline-none">
            {product.name}
          </Link>
        </h3>
        {showRating && <Rating value={product.rating} count={product.reviewCount} size={12} className="mt-1" />}
        <Price price={product.price} originalPrice={product.originalPrice} discount={product.discount} size="sm" className="mt-1" />
        <div className="mt-2 flex items-center gap-1.5" aria-label={`Available in ${product.colors.map((c) => c.name).join(", ")}`}>
          {product.colors.map((c) => (
            <span
              key={c.name}
              title={c.name}
              className="h-3.5 w-3.5 rounded-full border border-black/15"
              style={{ backgroundColor: c.hex }}
            />
          ))}
          {soldOut && <span className="ml-auto text-xs font-medium text-danger">Out of stock</span>}
        </div>
      </div>
    </article>
  );
});
