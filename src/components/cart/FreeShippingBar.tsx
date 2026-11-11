import { Truck } from "lucide-react";
import { FREE_SHIPPING_THRESHOLD, formatPrice } from "@/lib/utils";

export function FreeShippingBar({ subtotal }: { subtotal: number }) {
  const remaining = FREE_SHIPPING_THRESHOLD - subtotal;
  const pct = Math.min(100, (subtotal / FREE_SHIPPING_THRESHOLD) * 100);
  return (
    <div className="rounded-xl bg-canvas px-4 py-3">
      <p className="flex items-center gap-2 text-[13px] text-ink">
        <Truck size={16} className="text-gold-dark" />
        {remaining > 0 ? (
          <span>
            Add <strong>{formatPrice(remaining)}</strong> more for <strong>free delivery</strong>
          </span>
        ) : (
          <span>
            You&apos;ve unlocked <strong>free delivery</strong>!
          </span>
        )}
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
        <div className="h-full rounded-full bg-gradient-to-r from-gold to-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
