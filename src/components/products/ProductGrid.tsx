import type { Product } from "@/types";
import { cn } from "@/lib/utils";
import { ProductCard } from "./ProductCard";

interface ProductGridProps {
  products: Product[];
  className?: string;
  showRating?: boolean;
  /** Number of leading cards to load eagerly (above the fold). */
  priorityCount?: number;
  columns?: "default" | "wide";
}

export function ProductGrid({ products, className, showRating, priorityCount = 0, columns = "default" }: ProductGridProps) {
  return (
    <ul
      className={cn(
        "grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 md:grid-cols-3",
        columns === "default" ? "lg:grid-cols-4" : "xl:grid-cols-4",
        className,
      )}
    >
      {products.map((p, i) => (
        <li key={p.id}>
          <ProductCard product={p} showRating={showRating} priority={i < priorityCount} />
        </li>
      ))}
    </ul>
  );
}
