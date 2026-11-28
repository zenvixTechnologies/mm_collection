"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { galleryFor } from "@/lib/gallery";
import type { Product } from "@/types";
import { ProductGallery } from "./ProductGallery";

/**
 * The colour chosen on a product page, shared between the purchase panel (which owns the
 * selection) and the gallery beside it.
 */
const Context = createContext<{ color: string | null; setColor: (c: string | null) => void } | null>(null);

export function SelectedColourProvider({ product, children }: { product: Product; children: ReactNode }) {
  // The same starting choice as the picker: a product's only colour is pre-selected, so the first
  // render (server and client) already shows its photos.
  const [color, setColor] = useState<string | null>(product.colors.length === 1 ? product.colors[0].name : null);
  const value = useMemo(() => ({ color, setColor }), [color]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useReportColour = () => useContext(Context)?.setColor;

/** The product gallery for whichever colour is selected. */
export function ColourGallery({ product }: { product: Product }) {
  const color = useContext(Context)?.color ?? null;
  const gallery = galleryFor(product, color);
  return <ProductGallery images={gallery.images} name={color && gallery.source === "color" ? `${product.name}, ${color}` : product.name} galleryKey={color ?? ""} notice={gallery.notice} />;
}
