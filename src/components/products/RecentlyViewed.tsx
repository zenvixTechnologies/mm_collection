"use client";

import { getProductById } from "@/data/products";
import { useHydrated } from "@/hooks/use-hydrated";
import { useRecentStore } from "@/store/ui-store";
import type { Product } from "@/types";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ProductGrid } from "./ProductGrid";

export function RecentlyViewed({ excludeId, title = "Recently viewed" }: { excludeId?: string; title?: string }) {
  const hydrated = useHydrated();
  const ids = useRecentStore((s) => s.ids);
  if (!hydrated) return null;
  const items = ids
    .filter((id) => id !== excludeId)
    .map(getProductById)
    .filter((p): p is Product => !!p)
    .slice(0, 4);
  if (!items.length) return null;

  return (
    <section aria-labelledby="recent-heading" className="container-page mt-20">
      <SectionHeading id="recent-heading" title={title} />
      <ProductGrid products={items} />
    </section>
  );
}
