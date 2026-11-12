"use client";

import Link from "next/link";
import { AnimatePresence } from "framer-motion";
import { ArrowLeft, Lock, ShoppingBag } from "lucide-react";
import { useHydrated } from "@/hooks/use-hydrated";
import { calculateTotals } from "@/lib/pricing";
import { formatPrice } from "@/lib/utils";
import { useCartStore } from "@/store/cart-store";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { EmptyState } from "@/components/ui/EmptyState";
import { LineSkeleton } from "@/components/ui/Skeletons";
import { CartLine } from "./CartLine";
import { CouponForm } from "./CouponForm";
import { OrderSummary } from "./OrderSummary";

export function CartView() {
  const hydrated = useHydrated();
  const items = useCartStore((s) => s.items);
  const couponCode = useCartStore((s) => s.couponCode);
  const totals = calculateTotals(items, couponCode);

  return (
    <div className="container-page pt-6 lg:pt-8">
      <Breadcrumbs items={[{ label: "Shopping Bag" }]} />
      <h1 className="mt-4 font-display text-4xl font-semibold sm:text-5xl">
        Shopping Bag
        {hydrated && totals.itemCount > 0 && (
          <span className="ml-3 align-middle font-sans text-base font-normal text-muted">
            {totals.itemCount} item{totals.itemCount === 1 ? "" : "s"}
          </span>
        )}
      </h1>

      {!hydrated ? (
        <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_380px]">
          <LineSkeleton rows={2} />
          <div className="skeleton h-80 rounded-2xl" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ShoppingBag size={40} />}
          title="Your bag is empty"
          description="Looks like you haven't added anything yet. Explore our latest kurtis, dresses and festive wear."
          actionLabel="Shop Now"
          actionHref="/shop"
        >
          <Link href="/wishlist" className="mt-3 text-sm font-medium underline underline-offset-4">
            Check your wishlist
          </Link>
        </EmptyState>
      ) : (
        <div className="mt-8 grid gap-10 pb-24 lg:grid-cols-[1fr_380px] lg:pb-0">
          <section aria-label="Items in your bag">
            <ul className="divide-y divide-line border-b border-line">
              <AnimatePresence initial={false}>
                {items.map((item) => (
                  <CartLine key={item.key} item={item} />
                ))}
              </AnimatePresence>
            </ul>
            <Link href="/shop" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold hover:underline">
              <ArrowLeft size={16} /> Continue Shopping
            </Link>
          </section>

          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-2xl border border-line p-5">
              <CouponForm subtotal={totals.subtotal} />
            </div>
            <OrderSummary totals={totals} couponCode={couponCode}>
              <Link href="/checkout" className="btn-accent mt-5 hidden min-h-13 w-full text-[15px] lg:flex">
                <Lock size={16} /> Proceed to Checkout
              </Link>
              <Link href="/shop" className="btn-ghost mt-2 hidden w-full lg:flex">
                Continue Shopping
              </Link>
            </OrderSummary>
          </aside>

          {/* Mobile sticky checkout */}
          <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-4 border-t border-line bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
            <div>
              <p className="text-xs text-muted">Total · Shipping charges applicable</p>
              <p className="text-lg font-semibold">{formatPrice(totals.total)}</p>
            </div>
            <Link href="/checkout" className="btn-accent min-h-12 flex-1">
              <Lock size={15} /> Checkout
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
