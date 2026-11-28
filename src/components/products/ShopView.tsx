"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { AlertCircle, PackageOpen, Search, SearchX, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Audience, Category } from "@/types";
import { AUDIENCES, getAudience } from "@/data/audiences";
import { useCatalog } from "@/components/catalog/CatalogProvider";
import { categoryFullName } from "@/lib/catalog-query";
import { EMPTY_FILTERS, countActiveFilters, type Filters } from "@/lib/catalog";
import { listingQuery, listingSearch, parseListing, searchText, type ListingScope, type ListingState } from "@/lib/listing";
import { useListing } from "@/hooks/use-listing";
import type { InitialListing } from "@/server/services/listing-page";
import { cn, formatPrice } from "@/lib/utils";
import { Breadcrumbs, type Crumb } from "@/components/ui/Breadcrumbs";
import { Dialog } from "@/components/ui/Dialog";
import { ProductGridSkeleton } from "@/components/ui/Skeletons";
import { FilterPanel } from "./FilterPanel";
import { ProductGrid } from "./ProductGrid";
import { SortSelect } from "./SortSelect";

/** Typing in the search box is sent once it pauses; every other choice is sent at once. */
const SEARCH_DELAY_MS = 350;

interface ShopViewProps {
  title: string;
  description?: string;
  breadcrumbs: Crumb[];
  /** What this page lists. A sub-category page is locked to its category, so that filter is hidden. */
  scope: ListingScope;
  /** The server's answer for the URL the page was opened with. */
  initial: InitialListing;
  showCategoryNav?: boolean;
  /** Replaces the plain title/description header (collection pages pass a hero banner). */
  hero?: ReactNode;
  /** Show the "search within this listing" box. */
  searchable?: boolean;
}

export function ShopView({
  title,
  description,
  breadcrumbs,
  scope,
  initial,
  showCategoryNav = true,
  hero,
  searchable = true,
}: ShopViewProps) {
  const { categories, getCategoriesByAudience } = useCatalog();
  const pathname = usePathname();
  // The URL is the only record of the chosen filters, so refresh, sharing and Back/Forward all work.
  const state = parseListing(useSearchParams(), scope, categories);
  const { filters, sort } = state;
  const listing = useListing(initial, listingQuery(state, scope), state.page);
  const { items, total, facets, pending, loadingMore, error } = listing;

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [input, setInput] = useState(state.search);
  const [syncedSearch, setSyncedSearch] = useState(state.search);
  if (syncedSearch !== state.search) {
    // The search changed from outside the box (Back, a chip, "Clear all").
    setSyncedSearch(state.search);
    if (searchText(input) !== state.search) setInput(state.search);
  }
  const typing = useRef<number>(undefined);

  useEffect(() => {
    const cancel = () => window.clearTimeout(typing.current);
    window.addEventListener("popstate", cancel);
    return () => {
      window.removeEventListener("popstate", cancel);
      cancel();
    };
  }, []);

  /** Write a change to the URL, starting from what it says right now. */
  const commit = (change: (current: ListingState) => ListingState, mode: "push" | "replace" = "push") => {
    const now = new URLSearchParams(window.location.search);
    const next = change(parseListing(now, scope, categories));
    const url = pathname + listingSearch(next, scope, now.toString());
    if (url === window.location.pathname + window.location.search) return;
    // `null` lets Next.js notice the new URL.
    window.history[mode === "push" ? "pushState" : "replaceState"](null, "", url);
  };

  /** A new choice starts again at the first page and takes along whatever is typed in the box. */
  const update = (next: Filters, search = searchText(input)) => {
    window.clearTimeout(typing.current);
    commit((s) => ({ ...s, filters: next, search, page: 1 }));
  };

  const type = (value: string) => {
    setInput(value);
    window.clearTimeout(typing.current);
    typing.current = window.setTimeout(
      () => commit((s) => ({ ...s, search: searchText(value), page: 1 }), "replace"),
      SEARCH_DELAY_MS,
    );
  };

  // Women / Men / Kids / Home & Living tabs only appear when the listing actually mixes audiences.
  const audiencesHere = scope.audience ? [] : AUDIENCES.filter((a) => facets.audiences.some((x) => x.id === a.id));
  const showAudienceTabs = audiencesHere.length > 1;
  const selectedAudience = scope.audience ?? filters.audiences[0];
  const mixed = !selectedAudience && facets.audiences.length > 1;
  const activeCount = countActiveFilters(filters);
  const navCategories = selectedAudience ? getCategoriesByAudience(selectedAudience) : [];
  const lockedCategory = scope.category;

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
    setInput("");
    update(EMPTY_FILTERS, "");
  };

  const chips = buildChips(filters, categories);
  const emptyListing = !pending && !error && total === 0 && activeCount === 0 && !state.search;
  const loadMore = () => commit((s) => ({ ...s, page: listing.pages + 1 }), "replace");
  const panel = (
    <FilterPanel filters={filters} onChange={(f) => update(f)} options={facets} mixed={mixed} hideCategory={!!lockedCategory} />
  );
  const resultsLabel = pending ? "Updating…" : `${total} ${total === 1 ? "result" : "results"}`;

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

      {emptyListing ? (
        // A brand-new collection or category with nothing published yet — not a "no matches" state.
        <div className="flex flex-col items-center rounded-2xl bg-canvas px-6 py-16 text-center">
          <PackageOpen size={36} className="text-accent" aria-hidden />
          <h2 className="mt-4 font-display text-2xl font-semibold sm:text-3xl">New products arriving soon</h2>
          <p className="mt-2 max-w-md text-sm text-muted">
            We&apos;re adding pieces to {title} right now. Check back shortly, or explore the rest of the store in the meantime.
          </p>
          <Link href="/shop" className="btn-primary mt-6">
            Shop all products
          </Link>
        </div>
      ) : (
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
              {panel}
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
                  value={input}
                  maxLength={100}
                  onChange={(e) => type(e.target.value)}
                  placeholder={`Search in ${title}…`}
                  autoComplete="off"
                  className="field-input h-12 rounded-full pr-4 pl-11 text-[15px]"
                />
              </form>
            )}

            {/* Toolbar */}
            <div className="sticky top-16 z-20 -mx-4 mb-5 flex items-center justify-between gap-3 border-b border-line bg-white/95 px-4 py-3 backdrop-blur lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:pt-0 lg:backdrop-blur-none">
              <p id="results-heading" className="text-sm text-muted" aria-live="polite">
                {pending ? (
                  "Updating…"
                ) : error?.stale ? (
                  "Not updated"
                ) : (
                  <>
                    <strong className="text-ink">{total}</strong> {total === 1 ? "product" : "products"}
                  </>
                )}
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
                <SortSelect value={sort} onChange={(v) => commit((s) => ({ ...s, sort: v, page: 1 }))} />
              </div>
            </div>

            {(chips.length > 0 || state.search) && (
              <div className="mb-5 flex flex-wrap items-center gap-2">
                {state.search && (
                  <button
                    type="button"
                    onClick={() => {
                      setInput("");
                      update(filters, "");
                    }}
                    className="flex items-center gap-1.5 rounded-full bg-sand px-3 py-1.5 text-[13px] text-ink transition-colors hover:bg-line"
                    aria-label={`Clear search ${state.search}`}
                  >
                    &ldquo;{state.search}&rdquo;
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

            <div className={cn("transition-opacity duration-200", pending && "opacity-60")} aria-busy={pending || loadingMore}>
              {error?.stale ? (
                <div role="alert" className="flex flex-col items-center rounded-2xl bg-canvas px-6 py-16 text-center">
                  <AlertCircle size={36} className="text-accent" aria-hidden />
                  <h2 className="mt-4 text-xl font-semibold">We couldn&apos;t load these products</h2>
                  <p className="mt-1 max-w-sm text-sm text-muted">{error.message}</p>
                  <button type="button" onClick={listing.retry} className="btn-primary mt-6">
                    Try again
                  </button>
                </div>
              ) : items.length ? (
                <>
                  <ProductGrid products={items} priorityCount={4} columns="wide" />
                  {loadingMore && (
                    <div className="mt-8">
                      <ProductGridSkeleton count={4} />
                    </div>
                  )}
                  {!pending && !loadingMore && items.length < total && (
                    <div className="mt-12 flex flex-col items-center gap-3">
                      <p className="text-sm text-muted">
                        Showing {items.length} of {total}
                      </p>
                      <div className="h-1 w-48 overflow-hidden rounded-full bg-line" aria-hidden>
                        <div className="h-full bg-ink" style={{ width: `${(items.length / total) * 100}%` }} />
                      </div>
                      {error && (
                        <p role="alert" className="text-sm text-accent">
                          {error.message}
                        </p>
                      )}
                      <button type="button" onClick={error ? listing.retry : loadMore} className="btn-outline mt-2 px-10">
                        {error ? "Try again" : "Load more"}
                      </button>
                    </div>
                  )}
                </>
              ) : pending ? (
                <ProductGridSkeleton />
              ) : (
                <div className="flex flex-col items-center rounded-2xl bg-canvas px-6 py-16 text-center">
                  <SearchX size={36} className="text-accent" />
                  <h2 className="mt-4 text-xl font-semibold">
                    {state.search ? <>Nothing here matches &ldquo;{state.search}&rdquo;</> : "No products match these filters"}
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
      )}

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
              {pending ? resultsLabel : `Show ${resultsLabel}`}
            </button>
          </div>
        }
      >
        <div className="px-5">
          {panel}
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

function buildChips(f: Filters, categories: Category[]): Chip[] {
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
