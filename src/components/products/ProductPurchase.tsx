"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Check, RotateCcw, ShieldCheck, ShoppingBag, Truck, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import type { Product } from "@/types";
import { getAudience } from "@/data/audiences";
import { getCategory } from "@/data/categories";
import { usePurchase } from "@/hooks/use-purchase";
import { formatPrice } from "@/lib/utils";
import { useRecentStore } from "@/store/ui-store";
import { Price } from "@/components/ui/Price";
import { QuantitySelector } from "@/components/ui/QuantitySelector";
import { Rating } from "@/components/ui/Rating";
import { PincodeChecker } from "./PincodeChecker";
import { SizeGuide } from "./SizeGuide";
import { StockStatus } from "./StockStatus";
import { VariantPicker } from "./VariantPicker";
import { WishlistButton } from "./WishlistButton";

export function ProductPurchase({ product }: { product: Product }) {
  const p = usePurchase(product);
  const [guideOpen, setGuideOpen] = useState(false);
  const addRecent = useRecentStore((s) => s.add);
  const category = getCategory(product.categoryId);
  const audience = getAudience(product.audienceCategory);

  useEffect(() => addRecent(product.id), [addRecent, product.id]);

  /** If size/colour is missing, bring the picker (and its error) into view — matters most from the mobile sticky bar. */
  const revealOptions = () => {
    if (p.soldOut) return;
    document.getElementById("pdp-variants")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div>
      <p className="eyebrow">
        <Link href={audience.href} className="hover:underline">
          {audience.label}
        </Link>
        {category && (
          <>
            <span aria-hidden className="mx-1.5 text-subtle">
              /
            </span>
            <Link href={`/categories/${category.slug}`} className="hover:underline">
              {category.name}
            </Link>
          </>
        )}
      </p>
      <div className="mt-2 flex items-start justify-between gap-3">
        <h1 className="font-display text-[32px] leading-tight font-semibold sm:text-[40px]">{product.name}</h1>
        <WishlistButton productId={product.id} productName={product.name} variant="outline" className="mt-1 h-11 w-11 sm:hidden" />
      </div>
      <a href="#reviews" className="mt-2 inline-flex items-center gap-2 text-sm text-muted hover:text-ink">
        <Rating value={product.rating} showValue size={15} />
        <span className="underline underline-offset-2">{product.reviewCount} reviews</span>
      </a>

      <div className="mt-5">
        <Price price={product.price} originalPrice={product.originalPrice} discount={product.discount} size="lg" />
        <p className="mt-1 text-xs text-muted">Inclusive of all taxes</p>
      </div>

      <p className="mt-5 text-[15px] leading-7 text-muted">{product.shortDescription}</p>

      <div id="pdp-variants" className="mt-7 scroll-mt-28">
        <VariantPicker
          product={product}
          size={p.size}
          color={p.color}
          onSize={p.setSize}
          onColor={p.setColor}
          errors={p.errors}
          onSizeGuide={() => setGuideOpen(true)}
          idPrefix="pdp"
        />
      </div>

      <div className="mt-6 flex items-center gap-4">
        <div>
          <p className="mb-2 text-sm font-semibold">Quantity</p>
          <QuantitySelector value={p.quantity} max={p.maxQty} onChange={p.setQuantity} />
        </div>
        <StockStatus stock={product.stock} className="mt-7" />
      </div>

      {/* Desktop / tablet actions */}
      <div className="mt-7 hidden gap-3 sm:flex">
        <AddButton onClick={() => p.addToCart({ openDrawer: true }) || revealOptions()} added={p.justAdded} disabled={p.soldOut} />
        <button type="button" onClick={() => p.buyNow() || revealOptions()} disabled={p.soldOut} className="btn-accent min-h-13 flex-1 text-[15px]">
          <Zap size={18} /> Buy Now
        </button>
        <WishlistButton productId={product.id} productName={product.name} variant="outline" className="h-13 w-13" />
      </div>
      {p.soldOut && (
        <p className="mt-3 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
          This piece is sold out right now. Save it to your wishlist and we&apos;ll keep it there for you.
        </p>
      )}

      <ul className="mt-7 grid grid-cols-3 gap-2 text-center text-xs text-muted">
        <li className="flex flex-col items-center gap-1.5 rounded-xl bg-canvas px-2 py-3">
          <Truck size={18} className="text-ink" /> Free delivery over {formatPrice(999)}
        </li>
        <li className="flex flex-col items-center gap-1.5 rounded-xl bg-canvas px-2 py-3">
          <RotateCcw size={18} className="text-ink" /> 7-day easy returns
        </li>
        <li className="flex flex-col items-center gap-1.5 rounded-xl bg-canvas px-2 py-3">
          <ShieldCheck size={18} className="text-ink" /> Quality checked
        </li>
      </ul>

      <div className="mt-6">
        <PincodeChecker />
      </div>

      <p className="mt-4 text-xs text-muted">SKU: {product.sku}</p>

      {/* Mobile sticky purchase bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:hidden">
        <div className="flex items-center gap-2">
          <div className="min-w-0 shrink-0 pr-1 leading-tight">
            <p className="text-[15px] font-semibold">{formatPrice(product.price)}</p>
            {product.discount > 0 && (
              <p className="text-[11px] text-muted">
                <span className="line-through">{formatPrice(product.originalPrice)}</span>{" "}
                <span className="font-semibold text-accent">{product.discount}% off</span>
              </p>
            )}
          </div>
          <AddButton onClick={() => p.addToCart() || revealOptions()} added={p.justAdded} disabled={p.soldOut} compact />
          <button type="button" onClick={() => p.buyNow() || revealOptions()} disabled={p.soldOut} className="btn-accent min-h-12 flex-1 px-3">
            Buy Now
          </button>
        </div>
      </div>

      <SizeGuide open={guideOpen} onClose={() => setGuideOpen(false)} product={product} />
    </div>
  );
}

function AddButton({ onClick, added, disabled, compact }: { onClick: () => void; added: boolean; disabled: boolean; compact?: boolean }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={{ scale: 0.97 }}
      className={compact ? "btn-primary min-h-12 flex-1 px-3" : "btn-primary min-h-13 flex-1 text-[15px]"}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={added ? "added" : "add"}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.15 }}
          className="flex items-center gap-2"
        >
          {added ? <Check size={18} /> : !compact && <ShoppingBag size={18} />}
          {disabled ? "Sold Out" : added ? "Added!" : "Add to Bag"}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}
