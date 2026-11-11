"use client";

import { BadgeCheck } from "lucide-react";
import { useState } from "react";
import type { Product } from "@/types";
import { getProductReviews } from "@/data/reviews";
import { formatDate } from "@/lib/utils";
import { toast } from "@/store/ui-store";
import { Dialog } from "@/components/ui/Dialog";
import { Rating } from "@/components/ui/Rating";

/** Approximate star distribution derived from the product's average rating (demo data). */
function distribution(rating: number, count: number) {
  const weights = [5, 4, 3, 2, 1].map((s) => Math.max(0.02, 1 - Math.abs(rating - s) / 1.6));
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => Math.round((w / total) * count));
}

export function ProductReviews({ product }: { product: Product }) {
  const reviews = getProductReviews(product.id);
  const dist = distribution(product.rating, product.reviewCount);
  const max = Math.max(...dist);
  const [writeOpen, setWriteOpen] = useState(false);
  const [stars, setStars] = useState(5);
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  return (
    <section id="reviews" aria-labelledby="reviews-heading" className="scroll-mt-24">
      <h2 id="reviews-heading" className="font-display text-3xl font-semibold">
        Ratings &amp; reviews
      </h2>
      <div className="mt-6 grid gap-8 lg:grid-cols-[280px_1fr] lg:gap-12">
        <div className="rounded-2xl bg-canvas p-6">
          <p className="font-display text-5xl font-semibold">{product.rating.toFixed(1)}</p>
          <Rating value={product.rating} size={18} className="mt-2" />
          <p className="mt-1 text-sm text-muted">Based on {product.reviewCount} reviews</p>
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
          <button type="button" onClick={() => setWriteOpen(true)} className="btn-outline mt-6 w-full">
            Write a review
          </button>
        </div>

        <ul className="divide-y divide-line">
          {reviews.map((r) => (
            <li key={r.id} className="py-5 first:pt-0">
              <div className="flex items-center justify-between gap-3">
                <Rating value={r.rating} size={13} />
                <span className="text-xs text-muted">{formatDate(r.date)}</span>
              </div>
              <p className="mt-2 font-semibold">{r.title}</p>
              <p className="mt-1 text-[14.5px] leading-7 text-muted">{r.comment}</p>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                <span className="font-medium text-ink">{r.name}</span> · {r.location}
                <span className="flex items-center gap-1 text-success">
                  <BadgeCheck size={13} /> Verified buyer
                </span>
              </p>
            </li>
          ))}
        </ul>
      </div>

      <Dialog open={writeOpen} onClose={() => setWriteOpen(false)} title="Write a review" variant="bottom-sheet">
        <form
          className="space-y-5 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim().length < 10) {
              setError("Please write at least 10 characters.");
              return;
            }
            setWriteOpen(false);
            setText("");
            setError("");
            toast.success("Thanks! Your review has been submitted for moderation.");
          }}
        >
          <p className="text-sm text-muted">Reviewing: <strong className="text-ink">{product.name}</strong></p>
          <fieldset>
            <legend className="field-label">Your rating</legend>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStars(s)}
                  aria-label={`${s} star${s > 1 ? "s" : ""}`}
                  aria-pressed={stars === s}
                  className={`text-3xl leading-none ${s <= stars ? "text-gold" : "text-line"}`}
                >
                  ★
                </button>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="review-text" className="field-label">
              Your review
            </label>
            <textarea
              id="review-text"
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-invalid={error ? true : undefined}
              className="field-input h-auto py-3"
              placeholder="How was the fit, fabric and colour?"
            />
            {error && <p className="field-error">{error}</p>}
          </div>
          <button type="submit" className="btn-primary w-full">
            Submit review
          </button>
          <p className="text-center text-xs text-muted">Demo store: reviews are not published.</p>
        </form>
      </Dialog>
    </section>
  );
}
