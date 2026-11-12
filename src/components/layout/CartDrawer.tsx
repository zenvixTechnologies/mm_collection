"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import { ShoppingBag } from "lucide-react";
import { useEffect } from "react";
import { calculateTotals } from "@/lib/pricing";
import { formatPrice } from "@/lib/utils";
import { useCartStore } from "@/store/cart-store";
import { useUIStore } from "@/store/ui-store";
import { CartLine } from "@/components/cart/CartLine";
import { Dialog } from "@/components/ui/Dialog";

export function CartDrawer() {
  const open = useUIStore((s) => s.cartOpen);
  const setOpen = useUIStore((s) => s.setCartOpen);
  const items = useCartStore((s) => s.items);
  const couponCode = useCartStore((s) => s.couponCode);
  const pathname = usePathname();
  const totals = calculateTotals(items, couponCode);
  const close = () => setOpen(false);

  useEffect(() => setOpen(false), [pathname, setOpen]);

  return (
    <Dialog
      open={open}
      onClose={close}
      title={`Your Bag${totals.itemCount ? ` (${totals.itemCount})` : ""}`}
      variant="right"
      footer={
        items.length ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-muted">Subtotal</span>
              <span className="text-lg font-semibold">{formatPrice(totals.subtotal)}</span>
            </div>
            <p className="text-xs text-muted">Shipping Charges Applicable. Coupons can be applied in your bag.</p>
            <div className="grid grid-cols-2 gap-3">
              <Link href="/cart" className="btn-outline" onClick={close}>
                View Bag
              </Link>
              <Link href="/checkout" className="btn-accent" onClick={close}>
                Checkout
              </Link>
            </div>
          </div>
        ) : undefined
      }
    >
      {items.length ? (
        <div className="px-5 pt-4">
          <ul className="divide-y divide-line">
            <AnimatePresence initial={false}>
              {items.map((item) => (
                <CartLine key={item.key} item={item} compact onNavigate={close} />
              ))}
            </AnimatePresence>
          </ul>
        </div>
      ) : (
        <div className="flex h-full flex-col items-center justify-center px-6 py-16 text-center">
          <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-sand text-accent">
            <ShoppingBag size={32} />
          </div>
          <p className="font-display text-2xl font-semibold">Your bag is empty</p>
          <p className="mt-1 text-sm text-muted">Find something you love — it only takes a minute.</p>
          <Link href="/shop" onClick={close} className="btn-primary mt-6">
            Start Shopping
          </Link>
        </div>
      )}
    </Dialog>
  );
}
