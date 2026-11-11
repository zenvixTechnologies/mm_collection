"use client";

import { useRouter } from "next/navigation";
import { Search, SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import { getBestSellers } from "@/data/products";
import { POPULAR_SEARCHES, searchProducts, sortProducts, type SortValue } from "@/lib/catalog";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ProductGrid } from "./ProductGrid";
import { SortSelect } from "./SortSelect";

export function SearchResults({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [input, setInput] = useState(initialQuery);
  const [sort, setSort] = useState<SortValue>("featured");
  const results = useMemo(() => {
    const found = searchProducts(initialQuery);
    return sort === "featured" ? found : sortProducts(found, sort);
  }, [initialQuery, sort]);

  const submit = (q: string) => {
    const trimmed = q.trim();
    router.push(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : "/search");
  };

  return (
    <div className="container-page pt-6 lg:pt-8">
      <Breadcrumbs items={[{ label: "Search" }]} />
      <h1 className="mt-4 font-display text-4xl font-semibold sm:text-5xl">
        {initialQuery ? <>Results for &ldquo;{initialQuery}&rdquo;</> : "Search"}
      </h1>

      <form
        role="search"
        className="relative mt-6 max-w-xl"
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
      >
        <label htmlFor="search-page-input" className="sr-only">
          Search products
        </label>
        <Search size={18} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted" />
        <input
          id="search-page-input"
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search for dresses, kurtis, sarees…"
          className="field-input h-13 rounded-full pr-28 pl-11"
        />
        <button type="submit" className="btn-primary absolute top-1/2 right-1 min-h-11 -translate-y-1/2">
          Search
        </button>
      </form>

      {initialQuery && results.length > 0 && (
        <>
          <div className="mt-8 mb-5 flex items-center justify-between">
            <p className="text-sm text-muted" aria-live="polite">
              <strong className="text-ink">{results.length}</strong> {results.length === 1 ? "match" : "matches"}
            </p>
            <SortSelect value={sort} onChange={setSort} />
          </div>
          <ProductGrid products={results} priorityCount={4} />
        </>
      )}

      {(!initialQuery || results.length === 0) && (
        <div className="mt-10">
          {initialQuery && (
            <div className="mb-12 flex flex-col items-center rounded-2xl bg-canvas px-6 py-14 text-center">
              <SearchX size={36} className="text-accent" />
              <h2 className="mt-4 text-xl font-semibold">No results for &ldquo;{initialQuery}&rdquo;</h2>
              <p className="mt-1 text-sm text-muted">Check the spelling or try a broader term.</p>
            </div>
          )}
          <p className="mb-3 text-sm font-semibold">Popular searches</p>
          <div className="mb-14 flex flex-wrap gap-2">
            {POPULAR_SEARCHES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => submit(s)}
                className="rounded-full border border-line px-4 py-2 text-sm transition-colors hover:border-ink"
              >
                {s}
              </button>
            ))}
          </div>
          <SectionHeading title="Best sellers you might like" href="/best-sellers" />
          <ProductGrid products={getBestSellers(4)} />
        </div>
      )}
    </div>
  );
}
