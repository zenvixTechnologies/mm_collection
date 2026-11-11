import { cn, formatPrice } from "@/lib/utils";

interface PriceProps {
  price: number;
  originalPrice?: number;
  discount?: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function Price({ price, originalPrice, discount, size = "md", className }: PriceProps) {
  const showOriginal = originalPrice && originalPrice > price;
  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-2 gap-y-0.5", className)}>
      <span
        className={cn(
          "font-semibold text-ink",
          size === "sm" && "text-sm",
          size === "md" && "text-[15px]",
          size === "lg" && "text-2xl",
        )}
      >
        <span className="sr-only">Price: </span>
        {formatPrice(price)}
      </span>
      {showOriginal && (
        <span className={cn("text-muted line-through", size === "lg" ? "text-base" : "text-xs")}>
          <span className="sr-only">Original price: </span>
          {formatPrice(originalPrice)}
        </span>
      )}
      {showOriginal && discount ? (
        <span className={cn("font-semibold text-accent", size === "lg" ? "text-base" : "text-xs")}>
          {discount}% off
        </span>
      ) : null}
    </div>
  );
}
