"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, ChevronDown, Loader2, Tag, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { CheckoutCoupon, CheckoutSource, PublicCoupon } from "@/types";
import { fetchPublicCoupons } from "@/lib/checkout-api";
import { cn } from "@/lib/utils";
import { useCartStore } from "@/store/cart-store";
import { toast } from "@/store/ui-store";

interface CouponFormProps {
  /** Rupees — only used to grey out advertised coupons the bag doesn't reach yet. */
  subtotal: number;
  /** The server's verdict on the applied coupon, from the latest quote. */
  coupon?: CheckoutCoupon | null;
  /** What the coupon is checked against: the bag (default) or a Buy Now line. */
  source?: CheckoutSource;
}

/** Coupons are validated and priced only by the server; this form just sends the code. */
export function CouponForm({ subtotal, coupon = null, source }: CouponFormProps) {
  const couponCode = useCartStore((s) => s.couponCode);
  const applyCoupon = useCartStore((s) => s.applyCoupon);
  const removeCoupon = useCartStore((s) => s.removeCoupon);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [applying, setApplying] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const [available, setAvailable] = useState<PublicCoupon[] | null>(null);
  const [listError, setListError] = useState(false);

  useEffect(() => {
    if (!showList || available) return;
    let cancelled = false;
    fetchPublicCoupons()
      .then((list) => !cancelled && setAvailable(list))
      .catch(() => !cancelled && setListError(true));
    return () => {
      cancelled = true;
    };
  }, [showList, available]);

  // The verdict shown for the applied code: the latest quote's, once it covers this code.
  const verdict = couponCode && coupon?.code === couponCode ? coupon : null;
  const appliedInvalid = verdict?.status === "rejected";

  const apply = async (value: string) => {
    if (applying) return;
    setApplying(value || " ");
    const res = await applyCoupon(value, source);
    setApplying(null);
    if (res.ok) {
      setError("");
      setCode("");
      setShowList(false);
      toast.success(`${res.coupon.code} applied — ${res.coupon.description}`);
    } else {
      setError(res.error);
    }
  };

  return (
    <div>
      {couponCode ? (
        <div
          className={cn(
            "flex items-start gap-3 rounded-xl border border-dashed px-4 py-3",
            appliedInvalid ? "border-warning bg-[#fdf6ea]" : "border-success bg-success-soft",
          )}
        >
          {verdict ? (
            <CheckCircle2 size={18} className={cn("mt-0.5 shrink-0", appliedInvalid ? "text-warning" : "text-success")} />
          ) : (
            <Loader2 size={18} className="mt-0.5 shrink-0 animate-spin text-success" aria-label="Checking coupon" />
          )}
          <div className="flex-1 text-sm">
            <p className="font-semibold">{couponCode} applied</p>
            <p className="text-muted">{verdict ? (appliedInvalid ? verdict.message : verdict.description) : "Checking your coupon…"}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              removeCoupon();
              toast.info("Coupon removed");
            }}
            className="rounded-full p-1 text-muted hover:bg-white hover:text-ink"
            aria-label={`Remove coupon ${couponCode}`}
          >
            <X size={16} />
          </button>
        </div>
      ) : (
        // Not a <form>: this sits inside the checkout form, and nested forms are invalid HTML
        // (hydration error, and Enter could submit the order). Enter is handled on the input instead.
        <div role="group" aria-labelledby="coupon-label">
          <label id="coupon-label" htmlFor="coupon" className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Tag size={15} className="text-accent" /> Apply coupon
          </label>
          <div className="flex gap-2">
            <input
              id="coupon"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
                if (error) setError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void apply(code);
                }
              }}
              placeholder="Enter code"
              autoComplete="off"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "coupon-error" : undefined}
              className="field-input h-11 uppercase placeholder:normal-case"
            />
            <button type="button" onClick={() => void apply(code)} disabled={!!applying} className="btn-primary min-h-11 px-5">
              {applying && applying === (code || " ") ? <Loader2 size={16} className="animate-spin" aria-label="Applying" /> : "Apply"}
            </button>
          </div>
          {error && (
            <p id="coupon-error" className="field-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowList((s) => !s)}
        aria-expanded={showList}
        className="mt-3 flex items-center gap-1 text-[13px] font-medium text-accent hover:underline"
      >
        View available coupons <ChevronDown size={14} className={cn("transition-transform", showList && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {showList && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            {!available ? (
              <li className="mt-2 px-1 text-[13px] text-muted">{listError ? "Couldn't load coupons right now." : "Loading coupons…"}</li>
            ) : available.length === 0 ? (
              <li className="mt-2 px-1 text-[13px] text-muted">No coupons available right now.</li>
            ) : (
              available.map((c) => {
                const eligible = subtotal >= c.minOrder;
                return (
                  <li key={c.code} className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5">
                    <div className="min-w-0 text-[13px]">
                      <p className="font-bold tracking-wider">{c.code}</p>
                      <p className="text-muted">{c.description}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void apply(c.code)}
                      disabled={!eligible || couponCode === c.code || !!applying}
                      className="shrink-0 rounded-full border border-ink px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-ink hover:text-white disabled:border-line disabled:text-muted disabled:hover:bg-transparent"
                    >
                      {applying === c.code ? "Applying…" : couponCode === c.code ? "Applied" : eligible ? "Apply" : "Not eligible"}
                    </button>
                  </li>
                );
              })
            )}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
