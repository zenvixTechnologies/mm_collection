import type { Product } from "@/types";
import { cn } from "@/lib/utils";

/**
 * One badge per card keeps the grid calm. Most pieces carry a discount (already shown
 * next to the price), so "Sale" is reserved for the deepest markdowns.
 * Priority: Sold out → Sale (35%+) → New → Bestseller.
 */
export const SALE_BADGE_MIN_DISCOUNT = 35;

export function getBadge(product: Product): { label: string; tone: string } | null {
  if (product.stock <= 0) return { label: "Sold Out", tone: "bg-ink/80 text-white" };
  if (product.discount >= SALE_BADGE_MIN_DISCOUNT) return { label: "Sale", tone: "bg-accent text-white" };
  if (product.newArrival) return { label: "New", tone: "bg-white text-accent" };
  if (product.bestSeller) return { label: "Bestseller", tone: "bg-gradient-to-r from-[#ecd38a] to-[#c9a54c] text-royal" };
  return null;
}

export function ProductBadges({ product, className }: { product: Product; className?: string }) {
  const badge = getBadge(product);
  if (!badge) return null;
  return (
    <span
      className={cn(
        "inline-block rounded-full px-2.5 py-1 text-[10.5px] font-bold tracking-wider uppercase shadow-sm",
        badge.tone,
        className,
      )}
    >
      {badge.label}
    </span>
  );
}
