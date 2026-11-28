"use client";

import { useCatalog } from "@/components/catalog/CatalogProvider";
import { useHydrated } from "@/hooks/use-hydrated";
import { useRecentStore } from "@/store/ui-store";
import type { Product } from "@/types";
import { cn } from "@/lib/utils";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ProductGrid } from "./ProductGrid";

export function RecentlyViewed({ excludeId, title = "Recently viewed", className = "mt-20" }: { excludeId?: string; title?: string; className?: string }) {
  const hydrated = useHydrated();
  const ids = useRecentStore((s) => s.ids);
  const { getProductById } = useCatalog();
  if (!hydrated) return null;
  const items = ids
    .filter((id) => id !== excludeId)
    .map(getProductById)
    .filter((p): p is Product => !!p)
    .slice(0, 4);
  if (!items.length) return null;

  return (
    <section aria-labelledby="recent-heading" className={cn("container-page", className)}>
      <SectionHeading id="recent-heading" title={title} />
      <ProductGrid products={items} />
    </section>
  );
}
