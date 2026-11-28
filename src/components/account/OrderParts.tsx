"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Box, Check, CheckCircle2, ClipboardCheck, Home, Package, PackageCheck, Truck } from "lucide-react";
import type { OrderStatus, PaymentMethod, StoreOrder, StoreOrderStatus } from "@/types";
import { timelineSteps } from "@/lib/shipment";
import { cn, formatDate, formatPrice } from "@/lib/utils";
import { ProductImage } from "@/components/ui/ProductImage";

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cod: "Cash on Delivery",
  upi: "UPI",
  card: "Credit / Debit Card",
  netbanking: "Net Banking",
};

const STATUS_ICON: Record<OrderStatus | "Packed", typeof Check> = {
  "Order Placed": ClipboardCheck,
  Confirmed: CheckCircle2,
  Processing: Package,
  Packed: Box,
  Shipped: Truck,
  "Out for Delivery": Home,
  Delivered: PackageCheck,
};

export function StatusBadge({ status }: { status: StoreOrderStatus }) {
  const delivered = status === "Delivered";
  const moving = status === "Shipped" || status === "Out for Delivery";
  const waiting = status === "Payment Pending";
  const ended = status === "Cancelled" || status === "Expired" || status === "Payment Failed";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        delivered
          ? "bg-success-soft text-success"
          : moving
            ? "bg-accent-soft text-accent"
            : waiting
              ? "bg-[#fdf6ea] text-warning"
              : ended
                ? "bg-canvas text-muted"
                : "bg-sand text-ink",
      )}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full", delivered ? "bg-success" : moving ? "bg-accent" : waiting ? "bg-warning" : ended ? "bg-subtle" : "bg-ink")}
      />
      {status}
    </span>
  );
}

/** Visual order-progress timeline (vertical on mobile, horizontal on desktop). */
export function OrderTimeline({ order }: { order: StoreOrder }) {
  // Orders waiting for payment, or that ended unpaid, haven't reached the first step yet.
  const steps = timelineSteps(order);
  const current = steps.indexOf(order.status);
  return (
    <ol className={cn("relative grid gap-0", steps.length === 7 ? "md:grid-cols-7" : "md:grid-cols-6")} aria-label="Order progress">
      {steps.map((s, i) => {
        const done = i <= current;
        const Icon = STATUS_ICON[s as keyof typeof STATUS_ICON];
        const at = order.history[s];
        return (
          <li key={s} className="relative flex gap-4 pb-7 last:pb-0 md:flex-col md:items-center md:gap-3 md:pb-0 md:text-center">
            {/* connector */}
            {i < steps.length - 1 && (
              <>
                <span className="absolute top-10 bottom-0 left-5 w-0.5 -translate-x-1/2 bg-line md:top-5 md:right-[-50%] md:bottom-auto md:left-1/2 md:h-0.5 md:w-auto md:translate-x-0" aria-hidden />
                <motion.span
                  className="absolute top-10 left-5 w-0.5 origin-top -translate-x-1/2 bg-accent md:top-5 md:left-1/2 md:h-0.5 md:w-full md:origin-left md:translate-x-0"
                  style={{ bottom: 0 }}
                  initial={{ scaleY: 0, scaleX: 0 }}
                  animate={{ scaleY: i < current ? 1 : 0, scaleX: i < current ? 1 : 0 }}
                  transition={{ duration: 0.4, delay: i * 0.15 }}
                  aria-hidden
                />
              </>
            )}
            <motion.span
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: i * 0.12 }}
              className={cn(
                "relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2",
                done ? "border-accent bg-accent text-white" : "border-line bg-white text-subtle",
                i === current && "ring-4 ring-accent-soft",
              )}
            >
              {done && i < current ? <Check size={17} /> : <Icon size={17} />}
            </motion.span>
            <div className="pt-1.5 md:pt-0">
              <p className={cn("text-sm font-semibold", !done && "text-muted")}>{s}</p>
              <p className="text-xs text-muted">{at ? formatDate(at, true) : i === current + 1 ? "Up next" : "Pending"}</p>
            </div>
            {i === current && <span className="sr-only">(current status)</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** The order's current status and every status it has reached. */
export function OrderUpdates({ order }: { order: StoreOrder }) {
  const updates = (Object.entries(order.history) as [StoreOrderStatus, string][]).sort(([, a], [, b]) => Date.parse(b) - Date.parse(a));
  const facts: [string, string][] = [
    ["Order number", order.id],
    ["Current status", order.status],
    ...(order.lastUpdatedAt ? ([["Last updated", formatDate(order.lastUpdatedAt, true)]] as [string, string][]) : []),
  ];
  return (
    <div className="text-sm">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[13px] text-muted">{label}</dt>
            <dd className="font-medium break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {updates.length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <h3 className="mb-2 font-semibold">Status history</h3>
          <ol className="space-y-1.5 text-[13px]" aria-label="Status history">
            {updates.map(([status, at]) => (
              <li key={status} className="flex flex-wrap justify-between gap-x-3">
                <span className="font-medium">{status}</span>
                <time dateTime={at} className="text-muted">
                  {formatDate(at, true)}
                </time>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

export function OrderItems({ order, itemFooter }: { order: StoreOrder; itemFooter?: (item: StoreOrder["items"][number], index: number) => React.ReactNode }) {
  return (
    <ul className="divide-y divide-line">
      {order.items.map((it, index) => (
        <li key={it.sku ?? `${it.productId}-${it.size}-${it.color}`} className="flex gap-4 py-4 first:pt-0 last:pb-0">
          <Link href={`/product/${it.slug}`} className="relative h-24 w-[76px] shrink-0 overflow-hidden rounded-lg bg-sand">
            <ProductImage src={it.image} alt={it.name} fill sizes="76px" />
          </Link>
          <div className="min-w-0 flex-1 text-sm">
            <Link href={`/product/${it.slug}`} className="font-medium hover:underline">
              {it.name}
            </Link>
            <p className="mt-1 text-[13px] text-muted">
              {[it.size && `Size ${it.size}`, it.color && `Colour ${it.color}`, `Qty ${it.quantity}`].filter(Boolean).join(" · ")}
            </p>
            <p className="mt-1 text-[13px] text-muted">{formatPrice(it.price)} each</p>
            {itemFooter?.(it, index)}
          </div>
          <p className="text-sm font-semibold">{formatPrice(it.price * it.quantity)}</p>
        </li>
      ))}
    </ul>
  );
}

export function OrderTotals({ order }: { order: StoreOrder }) {
  return (
    <dl className="space-y-2.5 text-sm">
      <div className="flex justify-between">
        <dt className="text-muted">Subtotal</dt>
        <dd>{formatPrice(order.subtotal)}</dd>
      </div>
      {order.discount > 0 && (
        <div className="flex justify-between">
          <dt className="text-muted">Coupon{order.couponCode ? ` (${order.couponCode})` : ""}</dt>
          <dd className="text-success">− {formatPrice(order.discount)}</dd>
        </div>
      )}
      <div className="flex justify-between">
        <dt className="text-muted">Shipping</dt>
        <dd>{order.shipping === null ? "Shipping Charges Applicable" : order.shipping === 0 ? "FREE" : formatPrice(order.shipping)}</dd>
      </div>
      <div className="flex justify-between border-t border-line pt-2.5 text-base font-semibold">
        <dt>Total</dt>
        <dd>{formatPrice(order.total)}</dd>
      </div>
    </dl>
  );
}

export function AddressBlock({ order }: { order: StoreOrder }) {
  const a = order.address;
  return (
    <address className="text-sm leading-6 text-muted not-italic">
      <span className="font-medium text-ink">{order.customer.fullName}</span>
      <br />
      {a.house}, {a.street}
      <br />
      {a.city}, {a.district}
      <br />
      {a.state} – {a.pincode}, India
      <br />
      Mobile: {order.customer.mobile}
    </address>
  );
}
