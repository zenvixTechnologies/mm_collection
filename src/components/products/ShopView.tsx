"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Search, SearchX, SlidersHorizontal, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import type { Audience, Product } from "@/types";
import { AUDIENCES, getAudience } from "@/data/audiences";
import { categories, categoryFullName, getCategoriesByAudience } from "@/data/categories";
import {
  EMPTY_FILTERS,
  applyFilters,
  countActiveFilters,
  isSortValue,
  searchProducts,
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
  /** The page belongs to one audience (a collection or one of its sub-categories). */
  audience?: Audience;
  /** Pre-select an audience on mixed listings (Shop All, New Arrivals…) — from `?for=`. */
  initialAudience?: Audience;
  /** Replaces the plain title/description header (collection pages pass a hero banner). */
  hero?: ReactNode;
  /** Show the "search within this listing" box. */
  searchable?: boolean;
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
  audience,
  initialAudience,
  hero,
  searchable = true,
}: ShopViewProps) {
  const [sort, setSort] = useState<SortValue>(isSortValue(initialSort) ? initialSort : "featured");
  const [filters, setFilters] = useState<Filters>(() => {
    const cat = categories.find((c) => c.id === initialCategory);
    const aud = audience ? undefined : (cat?.audience ?? initialAudience);
    return {
      ...EMPTY_FILTERS,
      audiences: aud ? [aud] : [],
      categories: cat && (!aud || cat.audience === aud) ? [cat.id] : [],
    };
  });
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Women / Men / Kids tabs only appear when the listing actually mixes audiences.
  const audiencesHere = useMemo(
    () => AUDIENCES.filter((a) => products.some((p) => p.audienceCategory === a.id)),
    [products],
  );
  const showAudienceTabs = !audience && audiencesHere.length > 1;
  const selectedAudience = audience ?? (filters.audiences.length === 1 ? filters.audiences[0] : undefined);

  // Filter options (sizes, colours, sub-categories) follow the chosen audience.
  const panelSource = useMemo(
    () => (filters.audiences.length ? products.filter((p) => filters.audiences.includes(p.audienceCategory)) : products),
    [products, filters.audiences],
  );
  const searched = useMemo(
    () => (deferredQuery ? searchProducts(deferredQuery, products) : products),
    [products, deferredQuery],
  );
  const results = useMemo(() => sortProducts(applyFilters(searched, filters), sort), [searched, filters, sort]);
  const activeCount = countActiveFilters(filters);
  const navCategories = selectedAudience ? getCategoriesByAudience(selectedAudience) : [];

  // Keep sort/category/audience in the URL so filtered views can be shared and survive refresh.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (sort === "featured") url.searchParams.delete("sort");
    else url.searchParams.set("sort", sort);
    if (!lockedCategory) {
      if (filters.categories.length === 1) url.searchParams.set("category", filters.categories[0]);
      else url.searchParams.delete("category");
    }
    if (!audience) {
      if (filters.audiences.length === 1) url.searchParams.set("for", filters.audiences[0]);
      else url.searchParams.delete("for");
    }
    window.history.replaceState(window.history.state, "", url.toString());
  }, [sort, filters.categories, filters.audiences, lockedCategory, audience]);

  const update = (f: Filters) => {
    startTransition(() => {
      setFilters(f);
      setVisible(PAGE_SIZE);
    });
  };

  /** Switching audience drops sub-category filters that belong to another audience. */
  const pickAudience = (a: Audience | null) =>
    update({
      ...filters,
      audiences: a ? [a] : [],
      categories: a
        ? filters.categories.filter((c) => categories.find((x) => x.id === c)?.audience === a)
        : filters.categories,
    });

  const clearAll = () => {
    update(EMPTY_FILTERS);
    setQuery("");
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
      {hero ?? (
        <header className="mt-4 mb-6">
          <h1 className="font-display text-4xl font-semibold sm:text-5xl">{title}</h1>
          {description && <p className="mt-2 max-w-2xl text-muted">{description}</p>}
        </header>
      )}

      {showAudienceTabs && (
        <div role="group" aria-label="Shop for" className="mb-4 inline-flex max-w-full rounded-full bg-sand p-1">
          {[null, ...audiencesHere.map((a) => a.id)].map((a) => {
            const isActive = a === null ? filters.audiences.length === 0 : selectedAudience === a;
            return (
              <button
                key={a ?? "all"}
                type="button"
                aria-pressed={isActive}
                onClick={() => pickAudience(a)}
                className={cn(
                  "relative h-9 rounded-full px-4 text-sm font-semibold transition-colors sm:px-5",
                  isActive ? "text-white" : "text-muted hover:text-ink",
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="shop-audience-pill"
                    className="absolute inset-0 rounded-full bg-ink"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                )}
                <span className="relative">{a ? getAudience(a).label : "All"}</span>
              </button>
            );
          })}
        </div>
      )}

      {showCategoryNav && selectedAudience && (
        <nav aria-label="Categories" className="no-scrollbar -mx-4 mb-6 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
          <Link
            href={getAudience(selectedAudience).href}
            className={cn(
              "shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
              !lockedCategory ? "border-ink bg-ink text-white" : "border-line hover:border-ink",
            )}
          >
            All {getAudience(selectedAudience).label}
          </Link>
          {navCategories.map((c) => (
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
            <FilterPanel filters={filters} onChange={update} source={panelSource} hideCategory={!!lockedCategory} />
          </div>
        </aside>

        <section aria-labelledby="results-heading">
          {searchable && (
            <form role="search" className="relative mb-4" onSubmit={(e) => e.preventDefault()}>
              <label htmlFor="shop-search" className="sr-only">
                Search in {title}
              </label>
              <Search size={17} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted" />
              <input
                id="shop-search"
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setVisible(PAGE_SIZE);
                }}
                placeholder={`Search in ${title}…`}
                autoComplete="off"
                className="field-input h-12 rounded-full pr-4 pl-11 text-[15px]"
              />
            </form>
          )}

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

          {(chips.length > 0 || deferredQuery) && (
            <div className="mb-5 flex flex-wrap items-center gap-2">
              {deferredQuery && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="flex items-center gap-1.5 rounded-full bg-sand px-3 py-1.5 text-[13px] text-ink transition-colors hover:bg-line"
                  aria-label={`Clear search ${deferredQuery}`}
                >
                  &ldquo;{deferredQuery}&rdquo;
                  <X size={13} />
                </button>
              )}
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
              <button type="button" onClick={clearAll} className="px-2 text-[13px] font-medium text-accent hover:underline">
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
                <h2 className="mt-4 text-xl font-semibold">
                  {deferredQuery ? <>Nothing here matches &ldquo;{deferredQuery}&rdquo;</> : "No products match these filters"}
                </h2>
                <p className="mt-1 max-w-sm text-sm text-muted">
                  Try removing a filter, widening the price range or searching for something broader.
                </p>
                <button type="button" onClick={clearAll} className="btn-primary mt-6">
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
          <FilterPanel filters={filters} onChange={update} source={panelSource} hideCategory={!!lockedCategory} />
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
  f.audiences.forEach((a) =>
    chips.push({
      key: `a-${a}`,
      label: getAudience(a).label,
      remove: (x) => ({ ...x, audiences: x.audiences.filter((v) => v !== a) }),
    }),
  );
  f.categories.forEach((c) => {
    const cat = categories.find((x) => x.id === c);
    chips.push({
      key: `c-${c}`,
      label: cat ? categoryFullName(cat) : c,
      remove: (x) => ({ ...x, categories: x.categories.filter((v) => v !== c) }),
    });
  });
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
