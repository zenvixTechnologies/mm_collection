"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, ChevronDown, Tag, X } from "lucide-react";
import { useState } from "react";
import { coupons, findCoupon } from "@/data/coupons";
import { cn, formatPrice } from "@/lib/utils";
import { useCartStore } from "@/store/cart-store";
import { toast } from "@/store/ui-store";

export function CouponForm({ subtotal }: { subtotal: number }) {
  const couponCode = useCartStore((s) => s.couponCode);
  const applyCoupon = useCartStore((s) => s.applyCoupon);
  const removeCoupon = useCartStore((s) => s.removeCoupon);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [showList, setShowList] = useState(false);

  const applied = couponCode ? findCoupon(couponCode) : undefined;
  const appliedInvalid = applied && subtotal < applied.minOrder;

  const apply = (value: string) => {
    const res = applyCoupon(value, subtotal);
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
      {applied ? (
        <div
          className={cn(
            "flex items-start gap-3 rounded-xl border border-dashed px-4 py-3",
            appliedInvalid ? "border-warning bg-[#fdf6ea]" : "border-success bg-success-soft",
          )}
        >
          <CheckCircle2 size={18} className={cn("mt-0.5 shrink-0", appliedInvalid ? "text-warning" : "text-success")} />
          <div className="flex-1 text-sm">
            <p className="font-semibold">{applied.code} applied</p>
            <p className="text-muted">
              {appliedInvalid
                ? `Add ${formatPrice(applied.minOrder - subtotal)} more to use this coupon.`
                : applied.description}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              removeCoupon();
              toast.info("Coupon removed");
            }}
            className="rounded-full p-1 text-muted hover:bg-white hover:text-ink"
            aria-label={`Remove coupon ${applied.code}`}
          >
            <X size={16} />
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            apply(code);
          }}
          noValidate
        >
          <label htmlFor="coupon" className="mb-2 flex items-center gap-2 text-sm font-semibold">
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
              placeholder="Enter code"
              autoComplete="off"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "coupon-error" : undefined}
              className="field-input h-11 uppercase placeholder:normal-case"
            />
            <button type="submit" className="btn-primary min-h-11 px-5">
              Apply
            </button>
          </div>
          {error && (
            <p id="coupon-error" className="field-error" role="alert">
              {error}
            </p>
          )}
        </form>
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
            {coupons.map((c) => {
              const eligible = subtotal >= c.minOrder;
              return (
                <li key={c.code} className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5">
                  <div className="min-w-0 text-[13px]">
                    <p className="font-bold tracking-wider">{c.code}</p>
                    <p className="text-muted">{c.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => apply(c.code)}
                    disabled={!eligible || couponCode === c.code}
                    className="shrink-0 rounded-full border border-ink px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-ink hover:text-white disabled:border-line disabled:text-muted disabled:hover:bg-transparent"
                  >
                    {couponCode === c.code ? "Applied" : eligible ? "Apply" : "Not eligible"}
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
