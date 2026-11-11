"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Trash2 } from "lucide-react";
import type { CartItem } from "@/types";
import { formatPrice } from "@/lib/utils";
import { useCartStore } from "@/store/cart-store";
import { toast } from "@/store/ui-store";
import { ProductImage } from "@/components/ui/ProductImage";
import { QuantitySelector } from "@/components/ui/QuantitySelector";

export function CartLine({ item, compact = false, onNavigate }: { item: CartItem; compact?: boolean; onNavigate?: () => void }) {
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const othersQty = useCartStore((s) =>
    s.items.filter((i) => i.productId === item.productId && i.key !== item.key).reduce((n, i) => n + i.quantity, 0),
  );
  const max = Math.max(1, item.stock - othersQty);

  const change = (q: number) => {
    const res = updateQuantity(item.key, q);
    if (!res.ok) toast.error(res.error);
  };

  return (
    <motion.li
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, x: 24, transition: { duration: 0.2 } }}
      className="flex gap-4 py-4"
    >
      <Link
        href={`/product/${item.slug}`}
        onClick={onNavigate}
        className={compact ? "relative h-28 w-[88px] shrink-0 overflow-hidden rounded-lg bg-sand" : "relative h-36 w-28 shrink-0 overflow-hidden rounded-lg bg-sand sm:h-40 sm:w-32"}
      >
        <ProductImage src={item.image} alt={item.name} fill sizes="128px" />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <Link href={`/product/${item.slug}`} onClick={onNavigate} className="line-clamp-2 text-[15px] font-medium hover:underline">
            {item.name}
          </Link>
          <button
            type="button"
            onClick={() => {
              removeItem(item.key);
              toast.info(`${item.name} removed from bag`);
            }}
            className="-mt-1 -mr-1 shrink-0 rounded-full p-2 text-muted transition-colors hover:bg-danger-soft hover:text-danger"
            aria-label={`Remove ${item.name} from bag`}
          >
            <Trash2 size={16} />
          </button>
        </div>
        <p className="mt-1 text-[13px] text-muted">
          {[item.size && `Size: ${item.size}`, item.color && `Colour: ${item.color}`].filter(Boolean).join("  ·  ")}
        </p>
        {!compact && <p className="mt-1 text-[13px] text-muted">Unit price: {formatPrice(item.price)}</p>}
        <div className="mt-auto flex flex-wrap items-end justify-between gap-2 pt-3">
          <QuantitySelector value={item.quantity} max={max} onChange={change} size="sm" label={`Quantity for ${item.name}`} />
          <div className="text-right">
            <p className="font-semibold">{formatPrice(item.price * item.quantity)}</p>
            {item.originalPrice > item.price && (
              <p className="text-xs text-muted line-through">{formatPrice(item.originalPrice * item.quantity)}</p>
            )}
          </div>
        </div>
        {item.quantity >= max && (
          <p className="mt-1.5 text-xs text-warning">Maximum available quantity reached</p>
        )}
      </div>
    </motion.li>
  );
}
