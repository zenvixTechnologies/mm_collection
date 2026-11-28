"use client";

import { useCallback, useEffect, useState } from "react";
import type { Product, ProductVariant } from "@/types";
import { withVariants } from "@/lib/availability";

/**
 * Catalogue pages are cached for a few minutes, so when a size picker is shown this re-reads the
 * product's current variant stock from the product API. The first render uses the page's own data
 * (identical on server and client); if the request fails, that data stays. Cart and checkout
 * check stock again on the server either way.
 */
export function useLiveProduct(product: Product): { product: Product; refresh: () => void } {
  const [live, setLive] = useState<{ id: string; variants: ProductVariant[] } | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/v1/products/${encodeURIComponent(product.slug)}`, { cache: "no-store", signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { data?: { product?: Product } } | null) => {
        const fresh = body?.data?.product;
        if (fresh?.id === product.id && Array.isArray(fresh.variants)) setLive({ id: product.id, variants: fresh.variants });
      })
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [product.id, product.slug, version]);

  return {
    product: withVariants(product, live?.id === product.id ? live.variants : null),
    refresh: useCallback(() => setVersion((v) => v + 1), []),
  };
}
