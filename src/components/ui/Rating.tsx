import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface RatingProps {
  value: number;
  count?: number;
  size?: number;
  className?: string;
  showValue?: boolean;
}

export function Rating({ value, count, size = 14, className, showValue = false }: RatingProps) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <div className="flex items-center" role="img" aria-label={`Rated ${value.toFixed(1)} out of 5`}>
        {[1, 2, 3, 4, 5].map((i) => {
          const fill = Math.max(0, Math.min(1, value - (i - 1)));
          return (
            <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
              <Star className="absolute inset-0 text-line" fill="currentColor" strokeWidth={0} size={size} />
              <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                <Star className="text-gold" fill="currentColor" strokeWidth={0} size={size} />
              </span>
            </span>
          );
        })}
      </div>
      {showValue && <span className="text-sm font-semibold text-ink">{value.toFixed(1)}</span>}
      {count !== undefined && <span className="text-xs text-muted">({count})</span>}
    </div>
  );
}
