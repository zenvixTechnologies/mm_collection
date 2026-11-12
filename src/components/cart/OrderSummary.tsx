import type { CartTotals } from "@/types";
import { formatPrice } from "@/lib/utils";
import type { ReactNode } from "react";

interface OrderSummaryProps {
  totals: CartTotals;
  couponCode?: string | null;
  children?: ReactNode;
  title?: string;
}

export function OrderSummary({ totals, couponCode, children, title = "Order summary" }: OrderSummaryProps) {
  const mrpDiscount = totals.mrpTotal - totals.subtotal;
  return (
    <div className="rounded-2xl bg-canvas p-5 sm:p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <dl className="mt-4 space-y-3 text-[14.5px]">
        <Row label={`Total MRP (${totals.itemCount} item${totals.itemCount === 1 ? "" : "s"})`} value={formatPrice(totals.mrpTotal)} />
        {mrpDiscount > 0 && <Row label="Discount on MRP" value={`− ${formatPrice(mrpDiscount)}`} tone="success" />}
        <Row label="Subtotal" value={formatPrice(totals.subtotal)} />
        {totals.couponDiscount > 0 && (
          <Row label={`Coupon${couponCode ? ` (${couponCode})` : ""}`} value={`− ${formatPrice(totals.couponDiscount)}`} tone="success" />
        )}
        {/* Placeholder until shipping rates are configured — no amount is shown or added. */}
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted">Shipping</dt>
          <dd className="text-right text-[13.5px] font-medium">Shipping Charges Applicable</dd>
        </div>
        <div className="border-t border-line pt-3">
          <div className="flex items-baseline justify-between">
            <dt className="font-semibold">Total</dt>
            <dd className="text-xl font-semibold">{formatPrice(totals.total)}</dd>
          </div>
          <p className="mt-1 text-right text-xs text-muted">Inclusive of all taxes · Shipping charges applicable</p>
        </div>
      </dl>
      {totals.savings > 0 && (
        <p className="mt-4 rounded-lg bg-success-soft px-3 py-2 text-center text-[13px] font-medium text-success">
          You&apos;re saving {formatPrice(totals.savings)} on this order
        </p>
      )}
      {children}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "success" }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className={tone === "success" ? "font-medium text-success" : "font-medium"}>{value}</dd>
    </div>
  );
}
