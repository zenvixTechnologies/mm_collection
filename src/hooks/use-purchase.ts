"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLiveProduct } from "@/hooks/use-live-product";
import { sizeInStock, unitsFor } from "@/lib/availability";
import type { Product, Size } from "@/types";
import { cartKey } from "@/lib/utils";
import { useCartStore } from "@/store/cart-store";
import { useCheckoutStore } from "@/store/checkout-store";
import { toast, useUIStore } from "@/store/ui-store";

export interface PurchaseErrors {
  size?: string;
  color?: string;
}

const soldOutSize = (size: string, color: string | null) => `${size} is out of stock${color ? ` in ${color}` : ""}. Please choose another size.`;

/**
 * Selection + validation for buying a product. Single-option products
 * (e.g. "Free Size" sarees or one-colour pieces) are pre-selected; anything
 * with a real choice must be picked before it can go into the bag. Only
 * variants with stock available can be chosen.
 */
export function usePurchase(initial: Product) {
  const router = useRouter();
  const { product, refresh } = useLiveProduct(initial);
  const addItem = useCartStore((s) => s.addItem);
  const inCartQty = useCartStore((s) =>
    s.items.filter((i) => i.productId === product.id).reduce((n, i) => n + i.quantity, 0),
  );
  const setBuyNow = useCheckoutStore((s) => s.setBuyNow);
  const setCartOpen = useUIStore((s) => s.setCartOpen);

  const onlyColor = initial.colors.length === 1 ? initial.colors[0].name : null;
  /** A product's only size is pre-selected, as long as it can be bought. */
  const onlySize = (p: Product, c: string | null) => (p.sizes.length === 1 && sizeInStock(p, p.sizes[0], c) ? p.sizes[0] : null);

  const [chosenSize, setSizeState] = useState<Size | null>(() => onlySize(initial, onlyColor));
  const [color, setColorState] = useState<string | null>(onlyColor);
  const [wanted, setQuantity] = useState(1);
  const [errors, setErrors] = useState<PurchaseErrors>({});
  const [justAdded, setJustAdded] = useState(false);
  const [adding, setAdding] = useState(false);

  // Fresher stock can sell out the size already chosen: it stops being a selection.
  const size = chosenSize && sizeInStock(product, chosenSize, color) ? chosenSize : null;
  const lapsed = chosenSize && !size ? soldOutSize(chosenSize, color) : undefined;
  const shownErrors: PurchaseErrors = lapsed ? { ...errors, size: lapsed } : errors;

  /** Every variant is sold out. */
  const soldOut = product.stock <= 0;
  const complete = (!!size || !product.sizes.length) && (!!color || !product.colors.length);
  /** Units of exactly what is selected; before that, of the product (or of a sold-out colour). */
  const units = complete ? unitsFor(product, { size, color }) : null;
  const colorSoldOut = !soldOut && !!color && unitsFor(product, { color }) === 0;
  const displayStock = units ?? (colorSoldOut ? 0 : product.stock);
  const available = Math.max(0, (units ?? product.stock) - inCartQty);
  const maxQty = Math.max(1, Math.min(10, units ?? product.stock));
  const quantity = Math.min(wanted, maxQty);

  const setSize = (s: Size) => {
    if (!sizeInStock(product, s, color)) return;
    setSizeState(s);
    setErrors((e) => ({ ...e, size: undefined }));
  };
  const setColor = (c: string) => {
    setColorState(c);
    // A size that this colour doesn't have in stock is cleared, and must be chosen again.
    const keep = chosenSize && sizeInStock(product, chosenSize, c) ? chosenSize : null;
    const next = keep ?? onlySize(product, c);
    setSizeState(next);
    setErrors((e) => ({ ...e, color: undefined, size: chosenSize && !next ? soldOutSize(chosenSize, c) : undefined }));
  };

  const missing = (): PurchaseErrors => {
    const next: PurchaseErrors = {};
    if (!size && product.sizes.length > 0) next.size = colorSoldOut ? `No sizes are in stock in ${color}. Please choose another colour.` : (lapsed ?? "Please select a size");
    if (!color && product.colors.length > 0) next.color = "Please select a colour";
    if (!next.size && !next.color && unitsFor(product, { size, color }) <= 0) {
      next[product.sizes.length ? "size" : "color"] = "That option is out of stock. Please choose another.";
    }
    return next;
  };

  /** Checks the selection; returns the message to show, or null when it can be bought. */
  const validate = () => {
    const next = missing();
    setErrors(next);
    if (next.size && next.color) return "Please select a size and colour";
    return next.size ?? next.color ?? null;
  };

  /**
   * Adds the chosen variant to the bag (checked against live stock and priced by the server).
   * Resolves to "added", "options" (a size/colour still has to be picked) or "error".
   */
  const addToCart = async (opts: { openDrawer?: boolean } = {}): Promise<"added" | "options" | "error"> => {
    if (soldOut || adding) return "error";
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return "options";
    }
    setAdding(true);
    const res = await addItem(product, size, color, quantity).finally(() => setAdding(false));
    if (!res.ok) {
      toast.error(res.error);
      refresh(); // the stock may have changed: show it
      return "error";
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
    return "added";
  };

  const buyNow = () => {
    if (soldOut) return false;
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return false;
    }
    const stock = unitsFor(product, { size, color });
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
      quantity: Math.min(quantity, stock),
      stock,
      audience: product.audienceCategory,
    });
    router.push("/checkout?mode=buy-now");
    return true;
  };

  return {
    /** The product with the latest variant stock. */
    product,
    size,
    color,
    quantity,
    setSize,
    setColor,
    setQuantity: (q: number) => setQuantity(Math.max(1, Math.min(maxQty, q))),
    errors: shownErrors,
    soldOut,
    displayStock,
    available,
    maxQty,
    justAdded,
    adding,
    addToCart,
    buyNow,
  };
}
