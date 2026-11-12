"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, Search, TrendingUp } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { POPULAR_SEARCHES, searchProducts } from "@/lib/catalog";
import { formatPrice } from "@/lib/utils";
import { useUIStore } from "@/store/ui-store";
import { getAudience } from "@/data/audiences";
import { getCategoriesByAudience } from "@/data/categories";
import { useActiveAudience } from "@/store/audience-store";
import { Dialog } from "@/components/ui/Dialog";
import { ProductImage } from "@/components/ui/ProductImage";

export function SearchOverlay() {
  const open = useUIStore((s) => s.searchOpen);
  const setOpen = useUIStore((s) => s.setSearchOpen);
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const audience = useActiveAudience();
  const deferred = useDeferredValue(query);
  const results = useMemo(() => searchProducts(deferred).slice(0, 6), [deferred]);

  useEffect(() => setOpen(false), [pathname, setOpen]);
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const submit = (q: string) => {
    if (!q.trim()) return;
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <Dialog open={open} onClose={() => setOpen(false)} title="Search products" hideTitle variant="top">
      <div className="container-page max-w-3xl pb-6">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            submit(query);
          }}
          className="relative"
        >
          <label htmlFor="site-search" className="sr-only">
            Search for dresses, kurtis, sarees and more
          </label>
          <Search size={20} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted" />
          <input
            id="site-search"
            data-autofocus
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search dresses, shirts, kids' frocks…"
            autoComplete="off"
            className="h-14 w-full rounded-full border border-line bg-canvas pr-28 pl-12 text-[16px] focus:border-ink focus:bg-white focus:outline-none"
          />
          <button type="submit" className="btn-primary absolute top-1/2 right-1.5 min-h-11 -translate-y-1/2 px-5">
            Search
          </button>
        </form>

        {query.trim() === "" ? (
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div>
              <p className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wider text-muted uppercase">
                <TrendingUp size={14} /> Popular searches
              </p>
              <div className="flex flex-wrap gap-2">
                {POPULAR_SEARCHES[audience].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => submit(s)}
                    className="rounded-full border border-line px-4 py-2 text-sm text-ink transition-colors hover:border-ink"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-3 text-xs font-semibold tracking-wider text-muted uppercase">
                Browse {getAudience(audience).possessive} categories
              </p>
              <div className="flex flex-wrap gap-2">
                {getCategoriesByAudience(audience)
                  .slice(0, 8)
                  .map((c) => (
                  <Link
                    key={c.id}
                    href={`/categories/${c.slug}`}
                    className="rounded-full bg-sand px-4 py-2 text-sm text-ink transition-colors hover:bg-line"
                  >
                    {c.name}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        ) : results.length ? (
          <div className="mt-5">
            <p className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">Products</p>
            <ul className="divide-y divide-line">
              {results.map((p) => (
                <li key={p.id}>
                  <Link href={`/product/${p.slug}`} className="flex items-center gap-4 rounded-lg py-2.5 hover:bg-canvas">
                    <div className="relative h-16 w-13 shrink-0 overflow-hidden rounded-md bg-sand">
                      <ProductImage src={p.images[0]} alt={p.name} fill sizes="52px" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium">{p.name}</p>
                      <p className="text-sm text-muted">
                        {formatPrice(p.price)}
                        <span className="ml-2 rounded-full bg-sand px-2 py-0.5 text-[11px] font-semibold text-ink">
                          {getAudience(p.audienceCategory).label}
                        </span>
                      </p>
                    </div>
                    <ArrowRight size={16} className="text-subtle" />
                  </Link>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => submit(query)} className="btn-outline mt-4 w-full">
              See all results for &ldquo;{query.trim()}&rdquo;
            </button>
          </div>
        ) : (
          <p className="mt-8 text-center text-muted">
            No products match &ldquo;{query.trim()}&rdquo;. Try &ldquo;kurti&rdquo; or &ldquo;dress&rdquo;.
          </p>
        )}
      </div>
    </Dialog>
  );
}
