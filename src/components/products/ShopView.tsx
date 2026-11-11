"use client";

import Link from "next/link";
import { SearchX, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import type { Product } from "@/types";
import { categories } from "@/data/categories";
import {
  EMPTY_FILTERS,
  applyFilters,
  countActiveFilters,
  isSortValue,
  sortProducts,
  type Filters,
  type SortValue,
} from "@/lib/catalog";
import { cn, formatPrice } from "@/lib/utils";
import { Breadcrumbs, type Crumb } from "@/components/ui/Breadcrumbs";
import { Dialog } from "@/components/ui/Dialog";
import { ProductGridSkeleton } from "@/components/ui/Skeletons";
import { FilterPanel } from "./FilterPanel";
import { ProductGrid } from "./ProductGrid";
import { SortSelect } from "./SortSelect";

const PAGE_SIZE = 12;

interface ShopViewProps {
  title: string;
  description?: string;
  breadcrumbs: Crumb[];
  products: Product[];
  initialSort?: string;
  initialCategory?: string;
  /** When the page itself is a category, don't repeat the category filter. */
  lockedCategory?: string;
  showCategoryNav?: boolean;
}

export function ShopView({
  title,
  description,
  breadcrumbs,
  products,
  initialSort,
  initialCategory,
  lockedCategory,
  showCategoryNav = true,
}: ShopViewProps) {
  const [sort, setSort] = useState<SortValue>(isSortValue(initialSort) ? initialSort : "featured");
  const [filters, setFilters] = useState<Filters>(() =>
    initialCategory && categories.some((c) => c.id === initialCategory)
      ? { ...EMPTY_FILTERS, categories: [initialCategory] }
      : EMPTY_FILTERS,
  );
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isPending, startTransition] = useTransition();

  const results = useMemo(() => sortProducts(applyFilters(products, filters), sort), [products, filters, sort]);
  const activeCount = countActiveFilters(filters);

  // Keep sort/category in the URL so filtered views can be shared and survive refresh.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (sort === "featured") url.searchParams.delete("sort");
    else url.searchParams.set("sort", sort);
    if (!lockedCategory) {
      if (filters.categories.length === 1) url.searchParams.set("category", filters.categories[0]);
      else url.searchParams.delete("category");
    }
    window.history.replaceState(window.history.state, "", url.toString());
  }, [sort, filters.categories, lockedCategory]);

  const update = (f: Filters) => {
    startTransition(() => {
      setFilters(f);
      setVisible(PAGE_SIZE);
    });
  };

  const chips = buildChips(filters);
  const shown = results.slice(0, visible);

  const loadMore = () => {
    setLoadingMore(true);
    // Brief skeleton so new rows don't pop in abruptly.
    window.setTimeout(() => {
      setVisible((v) => v + PAGE_SIZE);
      setLoadingMore(false);
    }, 350);
  };

  return (
    <div className="container-page pt-6 pb-10 lg:pt-8">
      <Breadcrumbs items={breadcrumbs} />
      <header className="mt-4 mb-6">
        <h1 className="font-display text-4xl font-semibold sm:text-5xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-muted">{description}</p>}
      </header>

      {showCategoryNav && (
        <nav aria-label="Categories" className="no-scrollbar -mx-4 mb-6 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
          <Link
            href="/shop"
            className={cn(
              "shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
              !lockedCategory ? "border-ink bg-ink text-white" : "border-line hover:border-ink",
            )}
          >
            All
          </Link>
          {categories.map((c) => (
            <Link
              key={c.id}
              href={`/categories/${c.slug}`}
              aria-current={lockedCategory === c.id ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                lockedCategory === c.id ? "border-ink bg-ink text-white" : "border-line hover:border-ink",
              )}
            >
              {c.name}
            </Link>
          ))}
        </nav>
      )}

      <div className="lg:grid lg:grid-cols-[250px_1fr] lg:gap-10">
        {/* Desktop filters */}
        <aside className="hidden lg:block" aria-label="Product filters">
          <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pr-2">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h2 className="text-base font-semibold">Filters</h2>
              {activeCount > 0 && (
                <button type="button" onClick={() => update(EMPTY_FILTERS)} className="text-sm text-accent hover:underline">
                  Clear all
                </button>
              )}
            </div>
            <FilterPanel filters={filters} onChange={update} source={products} hideCategory={!!lockedCategory} />
          </div>
        </aside>

        <section aria-labelledby="results-heading">
          {/* Toolbar */}
          <div className="sticky top-16 z-20 -mx-4 mb-5 flex items-center justify-between gap-3 border-b border-line bg-white/95 px-4 py-3 backdrop-blur lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:pt-0 lg:backdrop-blur-none">
            <p id="results-heading" className="text-sm text-muted" aria-live="polite">
              <strong className="text-ink">{results.length}</strong> {results.length === 1 ? "product" : "products"}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="flex h-11 items-center gap-2 rounded-full border border-line px-4 text-sm font-medium hover:border-ink lg:hidden"
              >
                <SlidersHorizontal size={15} />
                Filter
                {activeCount > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold text-white">
                    {activeCount}
                  </span>
                )}
              </button>
              <SortSelect value={sort} onChange={(v) => startTransition(() => setSort(v))} />
            </div>
          </div>

          {chips.length > 0 && (
            <div className="mb-5 flex flex-wrap items-center gap-2">
              {chips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => update(chip.remove(filters))}
                  className="flex items-center gap-1.5 rounded-full bg-sand px-3 py-1.5 text-[13px] text-ink transition-colors hover:bg-line"
                  aria-label={`Remove filter ${chip.label}`}
                >
                  {chip.label}
                  <X size={13} />
                </button>
              ))}
              <button type="button" onClick={() => update(EMPTY_FILTERS)} className="px-2 text-[13px] font-medium text-accent hover:underline">
                Clear all
              </button>
            </div>
          )}

          <div className={cn("transition-opacity duration-200", isPending && "opacity-60")}>
            {results.length ? (
              <>
                <ProductGrid products={shown} priorityCount={4} columns="wide" />
                {loadingMore && (
                  <div className="mt-8">
                    <ProductGridSkeleton count={4} />
                  </div>
                )}
                {visible < results.length && !loadingMore && (
                  <div className="mt-12 flex flex-col items-center gap-3">
                    <p className="text-sm text-muted">
                      Showing {shown.length} of {results.length}
                    </p>
                    <div className="h-1 w-48 overflow-hidden rounded-full bg-line" aria-hidden>
                      <div className="h-full bg-ink" style={{ width: `${(shown.length / results.length) * 100}%` }} />
                    </div>
                    <button type="button" onClick={loadMore} className="btn-outline mt-2 px-10">
                      Load more
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center rounded-2xl bg-canvas px-6 py-16 text-center">
                <SearchX size={36} className="text-accent" />
                <h2 className="mt-4 text-xl font-semibold">No products match these filters</h2>
                <p className="mt-1 max-w-sm text-sm text-muted">Try removing a filter or widening the price range.</p>
                <button type="button" onClick={() => update(EMPTY_FILTERS)} className="btn-primary mt-6">
                  Clear all filters
                </button>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Mobile / tablet filter drawer */}
      <Dialog
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Filters"
        variant="bottom-sheet"
        footer={
          <div className="flex gap-3">
            <button type="button" className="btn-outline flex-1" onClick={() => update(EMPTY_FILTERS)} disabled={!activeCount}>
              Clear all
            </button>
            <button type="button" className="btn-primary flex-[1.4]" onClick={() => setDrawerOpen(false)}>
              Show {results.length} {results.length === 1 ? "result" : "results"}
            </button>
          </div>
        }
      >
        <div className="px-5">
          <FilterPanel filters={filters} onChange={update} source={products} hideCategory={!!lockedCategory} />
        </div>
      </Dialog>
    </div>
  );
}

interface Chip {
  key: string;
  label: string;
  remove: (f: Filters) => Filters;
}

function buildChips(f: Filters): Chip[] {
  const chips: Chip[] = [];
  f.categories.forEach((c) =>
    chips.push({
      key: `c-${c}`,
      label: categories.find((x) => x.id === c)?.name ?? c,
      remove: (x) => ({ ...x, categories: x.categories.filter((v) => v !== c) }),
    }),
  );
  f.sizes.forEach((s) =>
    chips.push({ key: `s-${s}`, label: `Size ${s}`, remove: (x) => ({ ...x, sizes: x.sizes.filter((v) => v !== s) }) }),
  );
  f.colors.forEach((c) =>
    chips.push({ key: `col-${c}`, label: c, remove: (x) => ({ ...x, colors: x.colors.filter((v) => v !== c) }) }),
  );
  if (f.minPrice !== null || f.maxPrice !== null) {
    const label =
      f.minPrice !== null && f.maxPrice !== null
        ? `${formatPrice(f.minPrice)} – ${formatPrice(f.maxPrice)}`
        : f.minPrice !== null
          ? `Over ${formatPrice(f.minPrice)}`
          : `Under ${formatPrice((f.maxPrice ?? 0) + 1)}`;
    chips.push({ key: "price", label, remove: (x) => ({ ...x, minPrice: null, maxPrice: null }) });
  }
  if (f.inStockOnly) chips.push({ key: "stock", label: "In stock", remove: (x) => ({ ...x, inStockOnly: false }) });
  if (f.minDiscount !== null)
    chips.push({ key: "disc", label: `${f.minDiscount}%+ off`, remove: (x) => ({ ...x, minDiscount: null }) });
  return chips;
}
