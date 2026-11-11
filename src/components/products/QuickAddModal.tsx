"use client";

import Link from "next/link";
import { Check, ShoppingBag } from "lucide-react";
import { getProductById } from "@/data/products";
import { usePurchase } from "@/hooks/use-purchase";
import { useUIStore } from "@/store/ui-store";
import type { Product } from "@/types";
import { Dialog } from "@/components/ui/Dialog";
import { Price } from "@/components/ui/Price";
import { ProductImage } from "@/components/ui/ProductImage";
import { QuantitySelector } from "@/components/ui/QuantitySelector";
import { Rating } from "@/components/ui/Rating";
import { StockStatus } from "./StockStatus";
import { VariantPicker } from "./VariantPicker";

export function QuickAddModal() {
  const id = useUIStore((s) => s.quickAddId);
  const close = useUIStore((s) => s.closeQuickAdd);
  const product = id ? getProductById(id) : undefined;

  return (
    <Dialog open={!!product} onClose={close} title="Quick add" variant="bottom-sheet" className="sm:max-w-2xl">
      {/* key resets selections each time a different product opens */}
      {product && <QuickAddBody key={product.id} product={product} onDone={close} />}
    </Dialog>
  );
}

function QuickAddBody({ product, onDone }: { product: Product; onDone: () => void }) {
  const p = usePurchase(product);

  return (
    <div className="grid gap-5 p-5 sm:grid-cols-[200px_1fr]">
      <div className="hidden sm:block">
        <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-sand">
          <ProductImage src={product.images[0]} alt={product.name} fill sizes="200px" />
        </div>
        <Link href={`/product/${product.slug}`} onClick={onDone} className="mt-3 block text-center text-sm font-medium underline underline-offset-4">
          View full details
        </Link>
      </div>
      <div>
        <div className="flex gap-3 sm:block">
          <div className="relative h-24 w-[76px] shrink-0 overflow-hidden rounded-lg bg-sand sm:hidden">
            <ProductImage src={product.images[0]} alt={product.name} fill sizes="76px" />
          </div>
          <div>
            <h3 className="text-lg leading-snug font-semibold">{product.name}</h3>
            <Rating value={product.rating} count={product.reviewCount} className="mt-1" size={13} />
            <Price price={product.price} originalPrice={product.originalPrice} discount={product.discount} className="mt-2" />
          </div>
        </div>
        <StockStatus stock={product.stock} className="mt-3" />
        <div className="mt-5">
          <VariantPicker
            product={product}
            size={p.size}
            color={p.color}
            onSize={p.setSize}
            onColor={p.setColor}
            errors={p.errors}
            idPrefix="quick"
          />
        </div>
        <div className="mt-6 flex items-center gap-3">
          <QuantitySelector value={p.quantity} max={p.maxQty} onChange={p.setQuantity} />
          <button
            type="button"
            className="btn-primary flex-1"
            disabled={p.soldOut}
            onClick={() => {
              if (p.addToCart()) window.setTimeout(onDone, 450);
            }}
          >
            {p.justAdded ? <Check size={18} /> : <ShoppingBag size={18} />}
            {p.justAdded ? "Added" : "Add to Bag"}
          </button>
        </div>
        <Link href={`/product/${product.slug}`} onClick={onDone} className="mt-4 block text-center text-sm font-medium underline underline-offset-4 sm:hidden">
          View full details
        </Link>
      </div>
    </div>
  );
}
