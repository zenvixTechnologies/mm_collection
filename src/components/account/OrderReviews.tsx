"use client";

import { BadgeCheck, ImagePlus, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OrderProductReview, ProductReview, StoreOrder } from "@/types";
import { ApiError, errorMessage } from "@/lib/api-client";
import { customerApi } from "@/lib/customer-api";
import { uploadReviewPhoto } from "@/lib/review-upload";
import { MAX_REVIEW_IMAGES, REVIEW_IMAGE_TYPES, checkReviewImage, itemReviewView, uploadBlocker, type ItemReviewView } from "@/lib/reviews";
import { useAuthStore } from "@/store/auth-store";
import { toast } from "@/store/ui-store";
import { ReviewImages } from "@/components/products/ReviewImages";
import { Dialog } from "@/components/ui/Dialog";
import { Rating } from "@/components/ui/Rating";
import { OrderItems } from "./OrderParts";

type Item = StoreOrder["items"][number];

/** The order's items, each product with its own review controls. The only place to write a review. */
export function ReviewableOrderItems({ order }: { order: StoreOrder }) {
  const authStatus = useAuthStore((s) => s.status);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const [writing, setWriting] = useState<Item | null>(null);

  // The server's answer, remembered together with who and which order it was for.
  const key = `${userId}:${order.id}`;
  const [loaded, setLoaded] = useState<{ key: string; entries: OrderProductReview[] | null; failure: "not-yours" | "error" | null } | null>(null);
  useEffect(() => {
    if (authStatus !== "authenticated" || !userId) return;
    const ctrl = new AbortController();
    customerApi<OrderProductReview[]>(`/orders/${encodeURIComponent(order.id)}/reviews`, { signal: ctrl.signal })
      .then((r) => setLoaded({ key, entries: r.data, failure: null }))
      .catch((err: unknown) => {
        if ((err as Error).name !== "AbortError") setLoaded({ key, entries: null, failure: err instanceof ApiError && err.status === 404 ? "not-yours" : "error" });
      });
    return () => ctrl.abort();
  }, [authStatus, userId, order.id, order.status, key, version]);
  const current = loaded?.key === key ? loaded : null;

  // A product bought in two sizes is still one product: its controls appear once.
  const firstLine = new Map<string, number>();
  order.items.forEach((item, i) => {
    if (!firstLine.has(item.productId)) firstLine.set(item.productId, i);
  });

  return (
    <>
      <OrderItems
        order={order}
        itemFooter={(item, index) => {
          if (firstLine.get(item.productId) !== index) return null;
          const entry = current?.entries?.find((e) => e.productId === item.productId) ?? null;
          return (
            <ItemReview
              view={itemReviewView(authStatus, order.status, entry, current?.failure ?? null)}
              review={entry?.review ?? null}
              productName={item.name}
              onWrite={() => setWriting(item)}
              onRetry={refresh}
            />
          );
        }}
      />
      {writing && (
        <ReviewDialog
          key={writing.productId}
          orderId={order.id}
          item={writing}
          onClose={() => setWriting(null)}
          // Also after a refusal: show the server's current answer.
          onChanged={refresh}
        />
      )}
    </>
  );
}

function ItemReview({ view, review, productName, onWrite, onRetry }: { view: ItemReviewView; review: ProductReview | null; productName: string; onWrite: () => void; onRetry: () => void }) {
  if (view.reviewed) {
    return (
      <div className="mt-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-xs font-semibold text-success">
          <BadgeCheck size={13} aria-hidden /> Reviewed
        </span>
        {review && (
          <div className="mt-2">
            <Rating value={review.rating} size={13} />
            <p className="mt-1 text-[13px] leading-6 break-words whitespace-pre-line text-muted">{review.comment}</p>
            <ReviewImages images={review.images} author={review.authorName} />
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="mt-3">
      {view.button !== "hidden" && (
        <button
          type="button"
          onClick={onWrite}
          disabled={view.button === "off"}
          className="btn-outline min-h-10 px-5 text-[13px] disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={`Write a review of ${productName}`}
        >
          Write Review
        </button>
      )}
      {view.message && (
        <p className="mt-2 text-xs leading-5 text-muted">
          {view.message}{" "}
          {view.retry && (
            <button type="button" onClick={onRetry} className="font-semibold text-ink underline">
              Try again
            </button>
          )}
        </p>
      )}
    </div>
  );
}

interface Photo {
  key: number;
  name: string;
  preview: string;
  status: "uploading" | "done" | "error";
  id?: string;
  error?: string;
}

function ReviewDialog({ orderId, item, onClose, onChanged }: { orderId: string; item: Item; onClose: () => void; onChanged: () => void }) {
  const [stars, setStars] = useState(5);
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photoNotice, setPhotoNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const nextKey = useRef(0);
  const previews = useRef(new Set<string>());

  useEffect(() => {
    const urls = previews.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const update = (key: number, patch: Partial<Photo>) => setPhotos((list) => list.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const addFiles = (files: File[]) => {
    const problems: string[] = [];
    const room = MAX_REVIEW_IMAGES - photos.length;
    if (files.length > room) problems.push(`You can add up to ${MAX_REVIEW_IMAGES} photos.`);
    const added: Photo[] = [];
    for (const file of files.slice(0, Math.max(0, room))) {
      const problem = checkReviewImage(file);
      if (problem) {
        problems.push(problem);
        continue;
      }
      const key = ++nextKey.current;
      const preview = URL.createObjectURL(file);
      previews.current.add(preview);
      added.push({ key, name: file.name, preview, status: "uploading" });
      uploadReviewPhoto(orderId, item.productId, file)
        .then((id) => update(key, { status: "done", id }))
        .catch((err: unknown) => update(key, { status: "error", error: errorMessage(err) }));
    }
    setPhotoNotice(problems.join(" "));
    setPhotos((list) => [...list, ...added]);
  };

  const remove = (photo: Photo) => {
    URL.revokeObjectURL(photo.preview);
    previews.current.delete(photo.preview);
    setPhotos((list) => list.filter((p) => p.key !== photo.key));
    setPhotoNotice("");
    setError("");
  };

  const blocker = uploadBlocker(photos);
  const failed = photos.filter((p) => p.status === "error");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || blocker) return;
    if (text.trim().length < 10) {
      setError("Please write at least 10 characters.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await customerApi<ProductReview>(`/orders/${encodeURIComponent(orderId)}/reviews`, {
        method: "POST",
        body: { productId: item.productId, rating: stars, comment: text.trim(), imageIds: photos.map((p) => p.id) },
      });
      toast.success("Thanks! Your review has been published.");
      onChanged();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && (err.status === 403 || err.status === 409)) onChanged();
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title="Write a review" variant="bottom-sheet">
      <form className="space-y-5 overflow-y-auto p-5" onSubmit={submit} noValidate>
        <p className="text-sm text-muted">
          Reviewing: <strong className="text-ink">{item.name}</strong>
        </p>
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
            maxLength={2000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="field-input h-auto py-3"
            placeholder="How was the fit, fabric and colour?"
          />
        </div>
        <div>
          <p className="field-label">Photos (optional)</p>
          <ul className="flex flex-wrap gap-2">
            {photos.map((p) => (
              <li key={p.key} className={`relative h-20 w-20 overflow-hidden rounded-lg border-2 bg-sand ${p.status === "error" ? "border-danger" : "border-transparent"}`}>
                {/* A local preview of the chosen file, so next/image has nothing to optimise. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.preview} alt={`Preview of ${p.name}`} className="h-full w-full object-cover" />
                {p.status !== "done" && (
                  <span className="absolute inset-0 flex items-center justify-center bg-white/70 text-xs font-semibold text-danger">
                    {p.status === "uploading" ? <Loader2 size={18} className="animate-spin text-ink" aria-label={`Uploading ${p.name}`} /> : "Failed"}
                  </span>
                )}
                <button type="button" onClick={() => remove(p)} disabled={saving} className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-white text-ink shadow" aria-label={`Remove ${p.name}`}>
                  <X size={13} />
                </button>
              </li>
            ))}
            {photos.length < MAX_REVIEW_IMAGES && (
              <li>
                <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-xs text-muted focus-within:ring-2 focus-within:ring-ink hover:bg-canvas">
                  <ImagePlus size={18} aria-hidden /> Add photo
                  <input
                    type="file"
                    accept={REVIEW_IMAGE_TYPES.join(",")}
                    multiple
                    className="sr-only"
                    disabled={saving}
                    onChange={(e) => {
                      addFiles(Array.from(e.target.files ?? []));
                      e.target.value = "";
                    }}
                  />
                </label>
              </li>
            )}
          </ul>
          <p className="mt-2 text-xs text-muted">Up to {MAX_REVIEW_IMAGES} photos. JPG, PNG or WebP, 5 MB each. They&apos;re shown publicly with your review.</p>
          {(photoNotice || failed.length > 0) && (
            <div className="field-error" role="alert">
              {photoNotice && <p>{photoNotice}</p>}
              {failed.map((p) => (
                <p key={p.key} className="break-words">
                  {p.name}: {p.error}
                </p>
              ))}
            </div>
          )}
        </div>
        {(error || blocker) && (
          <p className={error ? "field-error" : "text-xs text-muted"} role={error ? "alert" : "status"}>
            {error || blocker}
          </p>
        )}
        <button type="submit" className="btn-primary w-full disabled:opacity-60" disabled={saving || !!blocker}>
          {saving && <Loader2 size={16} className="animate-spin" />} Submit review
        </button>
        <p className="text-center text-xs text-muted">Your review is shown with your first name and last initial.</p>
      </form>
    </Dialog>
  );
}
