"use client";

import { useEffect, useRef, useState } from "react";
import type { Product } from "@/types";
import { createApiClient, errorMessage } from "@/lib/api-client";
import { PAGE_SIZE, restoredPages, withPage, type ListingFacets } from "@/lib/listing";
import type { InitialListing } from "@/server/services/listing-page";

const api = createApiClient({ base: "/api/v1", refreshPath: "/api/v1/auth/refresh" });

/** Results older than this when the page is shown again (e.g. with Back) are fetched anew. */
const FRESH_FOR_MS = 60_000;

/**
 * The products for the wanted query and number of pages, from /api/v1/products. The server
 * rendered the first answer; afterwards only what changed is requested — one page for "Load more",
 * a fresh first page for anything else. A newer choice cancels the request still in flight.
 */
export function useListing(initial: InitialListing, query: string, page: number) {
  const [data, setData] = useState<InitialListing>(initial);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const shownAt = useRef<number>(null);
  const key = `${query}#${page}`;

  // A navigation to this same page (say, a header link) brings new server results.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setData(initial);
  }

  const sameQuery = data.query === query;
  const settled = sameQuery && (data.pages === page || data.pages === restoredPages(page));

  useEffect(() => {
    shownAt.current ??= Date.now();
    const outdated = data.fetchedAt < shownAt.current - FRESH_FOR_MS;
    if (settled && !outdated) return;

    const controller = new AbortController();
    const append = !outdated && sameQuery && page === data.pages + 1;
    const pages = append ? page : restoredPages(page);
    const path = append ? withPage(query, page, PAGE_SIZE, false) : withPage(query, 1, PAGE_SIZE * pages, true);
    setFailure(null);

    api
      .request<Product[]>(`/products?${path}`, { signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return;
        const available = (res.meta?.filters as { available?: ListingFacets } | undefined)?.available;
        setData((previous) => {
          const known = new Set(append ? previous.items.map((p) => p.id) : []);
          return {
            query,
            pages,
            items: append ? [...previous.items, ...res.data.filter((p) => !known.has(p.id))] : res.data,
            total: res.pagination!.total,
            facets: available ?? previous.facets,
            fetchedAt: Date.now(),
          };
        });
      })
      .catch((err) => {
        if (!controller.signal.aborted) setFailure({ key, message: errorMessage(err) });
      });
    return () => controller.abort();
  }, [data, query, page, key, settled, sameQuery, attempt]);

  const error = !settled && failure?.key === key ? failure.message : null;

  return {
    items: data.items,
    total: data.total,
    facets: data.facets,
    pages: data.pages,
    /** Different products are on the way; what's shown answers the previous choice. */
    pending: !sameQuery && !error,
    loadingMore: sameQuery && !settled && !error,
    /** The wanted products couldn't be loaded. `stale` means what's shown is for a different choice. */
    error: error ? { message: error, stale: !sameQuery } : null,
    retry: () => {
      setFailure(null);
      setAttempt((n) => n + 1);
    },
  };
}
