"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Check, CheckCircle2, ClipboardCheck, Home, Package, PackageCheck, Truck } from "lucide-react";
import type { Order, OrderStatus, PaymentMethod } from "@/types";
import { ORDER_STATUSES } from "@/types";
import { cn, formatDate, formatPrice } from "@/lib/utils";
import { ProductImage } from "@/components/ui/ProductImage";

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cod: "Cash on Delivery",
  upi: "UPI (simulated)",
  card: "Credit / Debit Card (simulated)",
};

const STATUS_ICON = [ClipboardCheck, CheckCircle2, Package, Truck, Home, PackageCheck];

export function StatusBadge({ status }: { status: OrderStatus }) {
  const delivered = status === "Delivered";
  const moving = status === "Shipped" || status === "Out for Delivery";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        delivered ? "bg-success-soft text-success" : moving ? "bg-accent-soft text-accent" : "bg-sand text-ink",
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", delivered ? "bg-success" : moving ? "bg-accent" : "bg-ink")} />
      {status}
    </span>
  );
}

/** Visual order-progress timeline (vertical on mobile, horizontal on desktop). */
export function OrderTimeline({ order }: { order: Order }) {
  const current = ORDER_STATUSES.indexOf(order.status);
  return (
    <ol className="relative grid gap-0 md:grid-cols-6" aria-label="Order progress">
      {ORDER_STATUSES.map((s, i) => {
        const done = i <= current;
        const Icon = STATUS_ICON[i];
        const at = order.history[s];
        return (
          <li key={s} className="relative flex gap-4 pb-7 last:pb-0 md:flex-col md:items-center md:gap-3 md:pb-0 md:text-center">
            {/* connector */}
            {i < ORDER_STATUSES.length - 1 && (
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

export function OrderItems({ order }: { order: Order }) {
  return (
    <ul className="divide-y divide-line">
      {order.items.map((it) => (
        <li key={`${it.productId}-${it.size}-${it.color}`} className="flex gap-4 py-4 first:pt-0 last:pb-0">
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
          </div>
          <p className="text-sm font-semibold">{formatPrice(it.price * it.quantity)}</p>
        </li>
      ))}
    </ul>
  );
}

export function OrderTotals({ order }: { order: Order }) {
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

export function AddressBlock({ order }: { order: Order }) {
  const a = order.address;
  return (
    <address className="text-sm leading-6 text-muted not-italic">
      <span className="font-medium text-ink">{order.customer.fullName}</span>
      <br />
      {a.house}, {a.street}
      <br />
      {a.city}, {a.district}
      <br />
      {a.state} – {a.pincode}
      <br />
      Mobile: {order.customer.mobile}
    </address>
  );
}
