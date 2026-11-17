import type { ReactNode } from "react";
import type { AdminOrderStatus, PaymentStatus, ProductStatus } from "@/types/admin";
import type { StockState } from "@/lib/admin/metrics";
import { cn } from "@/lib/utils";

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "accent" | "gold" | "muted";

const TONES: Record<BadgeTone, { pill: string; dot: string }> = {
  neutral: { pill: "bg-sand text-ink", dot: "bg-ink" },
  success: { pill: "bg-success-soft text-success", dot: "bg-success" },
  warning: { pill: "bg-gold-soft text-warning", dot: "bg-warning" },
  danger: { pill: "bg-danger-soft text-danger", dot: "bg-danger" },
  accent: { pill: "bg-accent-soft text-accent", dot: "bg-accent" },
  gold: { pill: "bg-gold-soft text-gold-dark", dot: "bg-gold" },
  muted: { pill: "bg-line/70 text-muted", dot: "bg-subtle" },
};

/** Status pill — always a dot + text label, so state is never conveyed by colour alone. */
export function Badge({ tone = "neutral", children, className, dot = true }: { tone?: BadgeTone; children: ReactNode; className?: string; dot?: boolean }) {
  const t = TONES[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", t.pill, className)}>
      {dot && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", t.dot)} aria-hidden />}
      {children}
    </span>
  );
}

const ORDER_TONE: Record<AdminOrderStatus, BadgeTone> = {
  "Order Placed": "gold",
  Confirmed: "neutral",
  Processing: "neutral",
  Shipped: "accent",
  "Out for Delivery": "accent",
  Delivered: "success",
  Cancelled: "muted",
};

export function OrderStatusBadge({ status }: { status: AdminOrderStatus }) {
  return <Badge tone={ORDER_TONE[status]}>{status}</Badge>;
}

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  created: "Created",
  authorized: "Authorized",
  captured: "Paid",
  failed: "Failed",
  refunded: "Refunded",
  partially_refunded: "Part refunded",
};

const PAYMENT_TONE: Record<PaymentStatus, BadgeTone> = {
  created: "neutral",
  authorized: "neutral",
  captured: "success",
  failed: "danger",
  refunded: "gold",
  partially_refunded: "gold",
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <Badge tone={PAYMENT_TONE[status]}>{PAYMENT_STATUS_LABEL[status]}</Badge>;
}

const PRODUCT_TONE: Record<ProductStatus, BadgeTone> = { active: "success", draft: "neutral", archived: "muted" };

export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  return <Badge tone={PRODUCT_TONE[status]}>{status[0].toUpperCase() + status.slice(1)}</Badge>;
}

export function StockBadge({ state, stock }: { state: StockState; stock?: number }) {
  if (state === "out") return <Badge tone="danger">Out of stock</Badge>;
  if (state === "low") return <Badge tone="warning">Low{stock !== undefined ? ` · ${stock} left` : ""}</Badge>;
  return <Badge tone="success">In stock</Badge>;
}
