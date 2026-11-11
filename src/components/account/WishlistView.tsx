"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Heart, ShoppingBag, X } from "lucide-react";
import { useState } from "react";
import type { Product } from "@/types";
import { getProductById } from "@/data/products";
import { useHydrated } from "@/hooks/use-hydrated";
import { usePurchase } from "@/hooks/use-purchase";
import { toast } from "@/store/ui-store";
import { useWishlistStore } from "@/store/wishlist-store";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Price } from "@/components/ui/Price";
import { ProductImage } from "@/components/ui/ProductImage";
import { ProductGridSkeleton } from "@/components/ui/Skeletons";
import { RecentlyViewed } from "@/components/products/RecentlyViewed";
import { VariantPicker } from "@/components/products/VariantPicker";

export function WishlistView() {
  const hydrated = useHydrated();
  const ids = useWishlistStore((s) => s.ids);
  const remove = useWishlistStore((s) => s.remove);
  const [moving, setMoving] = useState<Product | null>(null);
  const items = ids.map(getProductById).filter((p): p is Product => !!p);

  return (
    <>
      <div className="container-page pt-6 lg:pt-8">
        <Breadcrumbs items={[{ label: "Wishlist" }]} />
        <h1 className="mt-4 font-display text-4xl font-semibold sm:text-5xl">
          My Wishlist
          {hydrated && items.length > 0 && (
            <span className="ml-3 align-middle font-sans text-base font-normal text-muted">
              {items.length} item{items.length === 1 ? "" : "s"}
            </span>
          )}
        </h1>

        {!hydrated ? (
          <div className="mt-8">
            <ProductGridSkeleton count={4} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Heart size={40} />}
            title="Your wishlist is empty"
            description="Tap the heart on any product to save it here for later."
            actionLabel="Explore Products"
            actionHref="/shop"
          />
        ) : (
          <ul className="mt-8 grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 md:grid-cols-3 lg:grid-cols-4">
            <AnimatePresence initial={false}>
              {items.map((p) => (
                <motion.li
                  key={p.id}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-col"
                >
                  <div className="relative aspect-[4/5] overflow-hidden rounded-[var(--radius-card)] bg-sand">
                    <Link href={`/product/${p.slug}`} aria-label={p.name}>
                      <ProductImage src={p.images[0]} alt={p.name} fill sizes="(min-width: 1024px) 25vw, 50vw" />
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        remove(p.id);
                        toast.info(`${p.name} removed from wishlist`);
                      }}
                      className="absolute top-2.5 right-2.5 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 shadow-sm hover:bg-white"
                      aria-label={`Remove ${p.name} from wishlist`}
                    >
                      <X size={16} />
                    </button>
                    {p.stock <= 0 && (
                      <span className="absolute bottom-2.5 left-2.5 rounded-full bg-ink/80 px-2.5 py-1 text-[10.5px] font-bold tracking-wider text-white uppercase">
                        Sold out
                      </span>
                    )}
                  </div>
                  <Link href={`/product/${p.slug}`} className="mt-3 line-clamp-1 text-[14.5px] font-medium hover:underline">
                    {p.name}
                  </Link>
                  <Price price={p.price} originalPrice={p.originalPrice} discount={p.discount} size="sm" className="mt-1" />
                  <button
                    type="button"
                    disabled={p.stock <= 0}
                    onClick={() => setMoving(p)}
                    className="btn-outline mt-3 min-h-10 w-full px-3 text-[13px]"
                  >
                    <ShoppingBag size={15} /> {p.stock <= 0 ? "Out of stock" : "Move to Bag"}
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>

      <Dialog open={!!moving} onClose={() => setMoving(null)} title="Choose your options" variant="bottom-sheet">
        {moving && (
          <MoveToCart
            key={moving.id}
            product={moving}
            onDone={() => {
              remove(moving.id);
              setMoving(null);
            }}
          />
        )}
      </Dialog>

      <RecentlyViewed title="You recently viewed" />
    </>
  );
}

function MoveToCart({ product, onDone }: { product: Product; onDone: () => void }) {
  const p = usePurchase(product);
  return (
    <div className="p-5">
      <div className="mb-5 flex gap-3">
        <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-sand">
          <ProductImage src={product.images[0]} alt={product.name} fill sizes="64px" />
        </div>
        <div>
          <p className="font-semibold">{product.name}</p>
          <Price price={product.price} originalPrice={product.originalPrice} discount={product.discount} size="sm" className="mt-1" />
        </div>
      </div>
      <VariantPicker
        product={product}
        size={p.size}
        color={p.color}
        onSize={p.setSize}
        onColor={p.setColor}
        errors={p.errors}
        idPrefix="wish"
      />
      <button
        type="button"
        className="btn-primary mt-6 w-full"
        onClick={() => {
          if (p.addToCart()) onDone();
        }}
      >
        <ShoppingBag size={17} /> Move to Bag
      </button>
    </div>
  );
}
