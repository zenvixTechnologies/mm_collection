"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Product, Size } from "@/types";
import { cartKey } from "@/lib/utils";
import { useCartStore } from "@/store/cart-store";
import { useCheckoutStore } from "@/store/checkout-store";
import { toast, useUIStore } from "@/store/ui-store";

export interface PurchaseErrors {
  size?: string;
  color?: string;
}

/**
 * Selection + validation for buying a product. Single-option products
 * (e.g. "Free Size" sarees or one-colour pieces) are pre-selected; anything
 * with a real choice must be picked before it can go into the bag.
 */
export function usePurchase(product: Product) {
  const router = useRouter();
  const addItem = useCartStore((s) => s.addItem);
  const inCartQty = useCartStore((s) =>
    s.items.filter((i) => i.productId === product.id).reduce((n, i) => n + i.quantity, 0),
  );
  const setBuyNow = useCheckoutStore((s) => s.setBuyNow);
  const setCartOpen = useUIStore((s) => s.setCartOpen);

  const [size, setSizeState] = useState<Size | null>(product.sizes.length === 1 ? product.sizes[0] : null);
  const [color, setColorState] = useState<string | null>(product.colors.length === 1 ? product.colors[0].name : null);
  const [quantity, setQuantity] = useState(1);
  const [errors, setErrors] = useState<PurchaseErrors>({});
  const [justAdded, setJustAdded] = useState(false);

  const soldOut = product.stock <= 0;
  const available = Math.max(0, product.stock - inCartQty);
  const maxQty = Math.max(1, Math.min(10, product.stock));

  const setSize = (s: Size) => {
    setSizeState(s);
    setErrors((e) => ({ ...e, size: undefined }));
  };
  const setColor = (c: string) => {
    setColorState(c);
    setErrors((e) => ({ ...e, color: undefined }));
  };

  const missingMessage = () => {
    const needSize = !size && product.sizes.length > 0;
    const needColor = !color && product.colors.length > 0;
    return needSize && needColor ? "Please select a size and colour" : needSize ? "Please select a size" : "Please select a colour";
  };

  const validate = () => {
    const next: PurchaseErrors = {};
    if (!size && product.sizes.length > 0) next.size = "Please select a size";
    if (!color && product.colors.length > 0) next.color = "Please select a colour";
    setErrors(next);
    return !next.size && !next.color;
  };

  const addToCart = (opts: { openDrawer?: boolean } = {}) => {
    if (soldOut) return false;
    if (!validate()) {
      toast.error(missingMessage());
      return false;
    }
    const res = addItem(product, size, color, quantity);
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    if (res.quantity < quantity) {
      toast.info(`Only ${res.quantity} more could be added — that's all we have in stock.`);
    } else if (!opts.openDrawer) {
      // When the bag drawer opens it is the confirmation; no need for a toast as well.
      toast.success(`Added to bag${size ? ` · Size ${size}` : ""}`, { label: "View bag", href: "/cart" });
    }
    setJustAdded(true);
    window.setTimeout(() => setJustAdded(false), 1800);
    if (opts.openDrawer) setCartOpen(true);
    return true;
  };

  const buyNow = () => {
    if (soldOut) return false;
    if (!validate()) {
      toast.error(missingMessage());
      return false;
    }
    const qty = Math.min(quantity, product.stock);
    setBuyNow({
      key: cartKey(product.id, size, color),
      productId: product.id,
      slug: product.slug,
      name: product.name,
      image: product.images[0],
      price: product.price,
      originalPrice: product.originalPrice,
      size,
      color,
      quantity: qty,
      stock: product.stock,
    });
    router.push("/checkout?mode=buy-now");
    return true;
  };

  return {
    size,
    color,
    quantity,
    setSize,
    setColor,
    setQuantity: (q: number) => setQuantity(Math.max(1, Math.min(maxQty, q))),
    errors,
    soldOut,
    available,
    maxQty,
    justAdded,
    addToCart,
    buyNow,
  };
}
