"use client";

import { useEffect, useRef, useState } from "react";
import type { CheckoutQuote, CheckoutSource } from "@/types";
import { errorMessage } from "@/lib/api-client";
import { fetchQuote } from "@/lib/checkout-api";

export type QuoteStatus = "idle" | "loading" | "ready" | "error";

interface QuoteState {
  quote: CheckoutQuote | null;
  status: QuoteStatus;
  error: string | null;
  /** A newer quote is being fetched (the previous one stays on screen meanwhile). */
  refreshing: boolean;
}

/**
 * Server-priced quote for the bag (or a Buy Now line) plus the coupon, refetched whenever the
 * bag, the line or the coupon changes. Prices from the previous quote are sent back so the server
 * can say which ones changed while the shopper was looking.
 *
 * @param source  null while what's being bought isn't known yet (e.g. the bag is still loading).
 * @param bagKey  changes whenever the bag's lines change (cart source only).
 */
export function useCheckoutQuote(source: CheckoutSource | null, couponCode: string | null, bagKey = "") {
  const [state, setState] = useState<QuoteState>({ quote: null, status: "idle", error: null, refreshing: false });
  const [nonce, setNonce] = useState(0);
  const seenPrices = useRef<Record<string, number>>({});
  const sourceKey = source ? JSON.stringify(source) : null;

  useEffect(() => {
    if (!sourceKey) return;
    const ctrl = new AbortController();
    setState((s) => ({ ...s, status: s.quote ? s.status : "loading", refreshing: true }));
    const expected = Object.keys(seenPrices.current).length ? seenPrices.current : undefined;
    fetchQuote(JSON.parse(sourceKey) as CheckoutSource, couponCode, { expectedPrices: expected, signal: ctrl.signal })
      .then((quote) => {
        seenPrices.current = Object.fromEntries(quote.items.map((i) => [i.key, Math.round(i.price * 100)]));
        setState({ quote, status: "ready", error: null, refreshing: false });
      })
      .catch((err: unknown) => {
        if ((err as Error).name === "AbortError") return;
        setState((s) => ({ ...s, status: s.quote ? "ready" : "error", error: errorMessage(err), refreshing: false }));
      });
    return () => ctrl.abort();
  }, [sourceKey, couponCode, bagKey, nonce]);

  return { ...state, refresh: () => setNonce((n) => n + 1) };
}
