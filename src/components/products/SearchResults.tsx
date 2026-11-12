"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import type { Audience } from "@/types";
import { AUDIENCES } from "@/data/audiences";
import { getBestSellers } from "@/data/products";
import { cn } from "@/lib/utils";
import { useActiveAudience } from "@/store/audience-store";
import { POPULAR_SEARCHES, searchProducts, sortProducts, type SortValue } from "@/lib/catalog";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ProductGrid } from "./ProductGrid";
import { SortSelect } from "./SortSelect";

export function SearchResults({ initialQuery, scope }: { initialQuery: string; scope: Audience | null }) {
  const router = useRouter();
  const browsing = useActiveAudience();
  const [input, setInput] = useState(initialQuery);
  const [sort, setSort] = useState<SortValue>("featured");
  const allMatches = useMemo(() => searchProducts(initialQuery), [initialQuery]);
  const results = useMemo(() => {
    const found = scope ? allMatches.filter((p) => p.audienceCategory === scope) : allMatches;
    return sort === "featured" ? found : sortProducts(found, sort);
  }, [allMatches, scope, sort]);
  const suggestFor = scope ?? browsing;

  const href = (q: string, s: Audience | null) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (s) params.set("for", s);
    const qs = params.toString();
    return qs ? `/search?${qs}` : "/search";
  };
  const submit = (q: string) => router.push(href(q.trim(), scope));

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

      {initialQuery && allMatches.length > 0 && (
        <nav aria-label="Search in" className="mt-6 flex flex-wrap gap-2">
          {[null, ...AUDIENCES.map((a) => a.id)].map((a) => {
            const count = a ? allMatches.filter((p) => p.audienceCategory === a).length : allMatches.length;
            const label = a ? AUDIENCES.find((x) => x.id === a)!.label : "All";
            return (
              <Link
                key={a ?? "all"}
                href={href(initialQuery, a)}
                aria-current={scope === a ? "page" : undefined}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                  scope === a ? "border-ink bg-ink text-white" : "border-line hover:border-ink",
                )}
              >
                {label} <span className={scope === a ? "text-white/70" : "text-muted"}>({count})</span>
              </Link>
            );
          })}
        </nav>
      )}

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
            {POPULAR_SEARCHES[suggestFor].map((s) => (
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
          <SectionHeading title="Best sellers you might like" href={`/best-sellers?for=${suggestFor}`} />
          <ProductGrid products={getBestSellers(4, suggestFor)} />
        </div>
      )}
    </div>
  );
}
