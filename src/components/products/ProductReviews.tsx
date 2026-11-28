"use client";

import Link from "next/link";
import { BadgeCheck, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Product, ProductReview, ProductReviewList } from "@/types";
import { errorMessage } from "@/lib/api-client";
import { customerApi } from "@/lib/customer-api";
import { formatDate } from "@/lib/utils";
import { toast } from "@/store/ui-store";
import { Rating } from "@/components/ui/Rating";
import { ReviewImages } from "./ReviewImages";

/** The published reviews. */
export function ReviewList({ items }: { items: ProductReview[] }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((r) => (
        <li key={r.id} className="py-5 first:pt-0">
          <div className="flex items-center justify-between gap-3">
            <Rating value={r.rating} size={13} />
            <span className="text-xs text-muted">{formatDate(r.createdAt)}</span>
          </div>
          {r.title && <p className="mt-2 font-semibold">{r.title}</p>}
          <p className="mt-1 text-[14.5px] leading-7 break-words whitespace-pre-line text-muted">{r.comment}</p>
          <ReviewImages images={r.images} author={r.authorName} />
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
            <span className="font-medium text-ink">{r.authorName}</span> ·
            <span className="flex items-center gap-1 text-success">
              <BadgeCheck size={13} /> Verified buyer
            </span>
          </p>
        </li>
      ))}
    </ul>
  );
}

/** Ratings and reviews on the product page — read-only. Reviews are written from the order page. */
export function ProductReviews({ product }: { product: Product }) {
  const base = `/products/${encodeURIComponent(product.slug)}/reviews`;

  const [list, setList] = useState<ProductReviewList | null>(null);
  const [listError, setListError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    const ctrl = new AbortController();
    setListError(false);
    customerApi<ProductReviewList>(base, { signal: ctrl.signal })
      .then((r) => setList(r.data))
      .catch((err: unknown) => {
        if ((err as Error).name !== "AbortError") setListError(true);
      });
    return () => ctrl.abort();
  }, [base, version]);

  const average = list?.average ?? product.rating;
  const count = list?.count ?? product.reviewCount;
  const dist = list?.distribution ?? [0, 0, 0, 0, 0];
  const max = Math.max(1, ...dist);

  const loadMore = async () => {
    if (!list) return;
    setLoadingMore(true);
    try {
      const { data } = await customerApi<ProductReviewList>(`${base}?page=${list.page + 1}`);
      const seen = new Set(list.items.map((r) => r.id));
      setList({ ...data, items: [...list.items, ...data.items.filter((r) => !seen.has(r.id))] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <section id="reviews" aria-labelledby="reviews-heading" className="scroll-mt-24">
      <h2 id="reviews-heading" className="font-display text-3xl font-semibold">
        Ratings &amp; reviews
      </h2>
      <div className="mt-6 grid gap-8 lg:grid-cols-[280px_1fr] lg:gap-12">
        <div className="rounded-2xl bg-canvas p-6">
          <p className="font-display text-5xl font-semibold">{count ? average.toFixed(1) : "—"}</p>
          <Rating value={average} size={18} className="mt-2" />
          <p className="mt-1 text-sm text-muted">{count ? `Based on ${count} review${count === 1 ? "" : "s"}` : "No reviews yet"}</p>
          <ul className="mt-5 space-y-2">
            {dist.map((n, i) => (
              <li key={i} className="flex items-center gap-3 text-xs text-muted">
                <span className="w-6">{5 - i}★</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                  <span className="block h-full rounded-full bg-gold" style={{ width: `${(n / max) * 100}%` }} />
                </span>
                <span className="w-7 text-right">{n}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 border-t border-line pt-4 text-center text-xs leading-5 text-muted">
            Bought this? Once it&apos;s delivered, you can review it from{" "}
            <Link href="/account/orders" className="font-semibold text-ink underline">
              My Orders
            </Link>
            .
          </p>
        </div>

        {list && list.items.length > 0 ? (
          <div>
            <ReviewList items={list.items} />
            {list.page < list.totalPages && (
              <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="btn-outline mt-4 min-h-10 px-6 text-[13px]">
                {loadingMore && <Loader2 size={15} className="animate-spin" />} Load more reviews
              </button>
            )}
          </div>
        ) : listError ? (
          <p className="text-sm text-muted" role="alert">
            We couldn&apos;t load reviews.{" "}
            <button type="button" onClick={refresh} className="font-semibold text-ink underline">
              Try again
            </button>
          </p>
        ) : list ? (
          <p className="text-sm text-muted">There are no reviews for this product yet.</p>
        ) : (
          <div className="skeleton h-40 rounded-2xl" role="status" aria-label="Loading reviews" />
        )}
      </div>
    </section>
  );
}
