"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Package, PackageSearch, Search } from "lucide-react";
import { useState } from "react";
import type { Order } from "@/types";
import { sampleOrders } from "@/data/orders";
import { useHydrated } from "@/hooks/use-hydrated";
import { useMyOrders } from "@/hooks/use-my-orders";
import { formatDate, formatPrice } from "@/lib/utils";
import { useCurrentUser } from "@/store/auth-store";
import { findOrder, useOrderStore } from "@/store/order-store";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProductImage } from "@/components/ui/ProductImage";
import { AccountShell } from "./AccountNav";
import { AddressBlock, OrderItems, OrderTimeline, OrderTotals, PAYMENT_LABEL, StatusBadge } from "./OrderParts";

/* ---------- My Orders ---------- */

export function OrdersListView() {
  const hydrated = useHydrated();
  const orders = useMyOrders();
  const user = useCurrentUser();

  return (
    <AccountShell title="My Orders">
      {!hydrated ? (
        <div className="space-y-4">
          <div className="skeleton h-40 rounded-2xl" />
          <div className="skeleton h-40 rounded-2xl" />
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-2xl border border-line">
          <EmptyState
            icon={<Package size={40} />}
            title="No orders yet"
            description={
              user
                ? "When you place an order it will appear here."
                : "Orders placed on this device appear here. Log in with the demo account to see sample order history."
            }
            actionLabel="Start Shopping"
            actionHref="/shop"
          >
            {!user && (
              <Link href="/login?next=/account/orders" className="mt-3 text-sm font-medium underline underline-offset-4">
                Log in
              </Link>
            )}
          </EmptyState>
        </div>
      ) : (
        <>
          {!user && (
            <p className="mb-4 rounded-xl bg-canvas px-4 py-3 text-sm text-muted">
              Showing guest orders placed on this device.{" "}
              <Link href="/login?next=/account/orders" className="font-semibold text-ink underline">
                Log in
              </Link>{" "}
              to see your full order history.
            </p>
          )}
          <ul className="space-y-4">
            {orders.map((o) => (
              <li key={o.id}>
                <OrderCard order={o} />
              </li>
            ))}
          </ul>
        </>
      )}
    </AccountShell>
  );
}

function OrderCard({ order }: { order: Order }) {
  const count = order.items.reduce((n, i) => n + i.quantity, 0);
  return (
    <article className="rounded-2xl border border-line transition-shadow hover:shadow-[var(--shadow-card)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-canvas px-5 py-3.5 text-sm">
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <p>
            <span className="text-muted">Order </span>
            <span className="font-semibold">#{order.id}</span>
          </p>
          <p className="text-muted">{formatDate(order.createdAt)}</p>
          <p className="font-semibold">{formatPrice(order.total)}</p>
        </div>
        <StatusBadge status={order.status} />
      </header>
      <div className="flex flex-wrap items-center gap-4 px-5 py-4">
        <div className="flex -space-x-3">
          {order.items.slice(0, 3).map((it) => (
            <div key={`${it.productId}-${it.size}`} className="relative h-16 w-13 overflow-hidden rounded-lg border-2 border-white bg-sand">
              <ProductImage src={it.image} alt={it.name} fill sizes="52px" />
            </div>
          ))}
        </div>
        <div className="min-w-0 flex-1 text-sm">
          <p className="line-clamp-1 font-medium">{order.items.map((i) => i.name).join(", ")}</p>
          <p className="text-muted">
            {count} item{count === 1 ? "" : "s"} · {PAYMENT_LABEL[order.paymentMethod]}
          </p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <Link href={`/track-order?id=${order.id}`} className="btn-ghost min-h-10 flex-1 border border-line px-4 text-[13px] sm:flex-none">
            Track
          </Link>
          <Link href={`/account/orders/${order.id}`} className="btn-primary min-h-10 flex-1 px-4 text-[13px] sm:flex-none">
            View details
          </Link>
        </div>
      </div>
    </article>
  );
}

/* ---------- Order details ---------- */

export function OrderDetailView({ id }: { id: string }) {
  const hydrated = useHydrated();
  const placed = useOrderStore((s) => s.orders);
  const order = hydrated ? findOrder(placed, id) : null;

  if (!hydrated) {
    return (
      <AccountShell title="Order Details">
        <div className="skeleton h-96 rounded-2xl" />
      </AccountShell>
    );
  }
  if (!order) {
    return (
      <AccountShell title="Order Details">
        <div className="rounded-2xl border border-line">
          <EmptyState icon={<PackageSearch size={40} />} title="Order not found" description={`We couldn't find order #${id}.`} actionLabel="Back to My Orders" actionHref="/account/orders" />
        </div>
      </AccountShell>
    );
  }

  return (
    <AccountShell title="Order Details">
      <Link href="/account/orders" className="mb-5 inline-flex items-center gap-2 text-sm font-medium hover:underline">
        <ArrowLeft size={15} /> All orders
      </Link>
      <div className="space-y-5">
        <section className="rounded-2xl border border-line p-5 sm:p-6">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Order #{order.id}</h2>
              <p className="text-sm text-muted">Placed on {formatDate(order.createdAt, true)}</p>
            </div>
            <StatusBadge status={order.status} />
          </div>
          <OrderTimeline order={order} />
        </section>
        <div className="grid gap-5 md:grid-cols-[1fr_280px]">
          <section className="rounded-2xl border border-line p-5 sm:p-6">
            <h2 className="mb-4 font-semibold">Items</h2>
            <OrderItems order={order} />
          </section>
          <div className="space-y-5">
            <section className="rounded-2xl border border-line p-5">
              <h2 className="mb-2 font-semibold">Delivery address</h2>
              <AddressBlock order={order} />
            </section>
            <section className="rounded-2xl border border-line p-5">
              <h2 className="mb-1 font-semibold">Payment</h2>
              <p className="mb-4 text-sm text-muted">{PAYMENT_LABEL[order.paymentMethod]}</p>
              <OrderTotals order={order} />
            </section>
            <Link href="/contact" className="btn-outline w-full">
              Need help with this order?
            </Link>
          </div>
        </div>
      </div>
    </AccountShell>
  );
}

/* ---------- Order tracking ---------- */

export function TrackOrderView({ initialId }: { initialId: string }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const placed = useOrderStore((s) => s.orders);
  const [input, setInput] = useState(initialId);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const order = hydrated && initialId ? findOrder(placed, initialId) : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = input.trim().toUpperCase();
    if (!id) return setError("Please enter your order ID.");
    if (!/^MM[A-Z0-9]{4,12}$/.test(id)) return setError("Order IDs start with “MM”, e.g. MM24A7K1.");
    setError("");
    setLoading(true);
    window.setTimeout(() => {
      setLoading(false);
      router.replace(`/track-order?id=${id}`);
    }, 400);
  };

  return (
    <div className="container-page max-w-4xl pt-6 lg:pt-8">
      <Breadcrumbs items={[{ label: "Track Order" }]} />
      <h1 className="mt-4 font-display text-4xl font-semibold sm:text-5xl">Track your order</h1>
      <p className="mt-2 text-muted">Enter the order ID from your confirmation to see its latest status.</p>

      <form onSubmit={submit} noValidate className="mt-6 flex max-w-xl flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <label htmlFor="order-id" className="sr-only">
            Order ID
          </label>
          <Search size={17} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted" />
          <input
            id="order-id"
            value={input}
            onChange={(e) => {
              setInput(e.target.value.toUpperCase());
              setError("");
            }}
            placeholder="e.g. MM24A7K1"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "order-id-error" : "order-id-hint"}
            className="field-input pl-11 uppercase placeholder:normal-case"
          />
        </div>
        <button type="submit" disabled={loading} className="btn-primary min-h-12 px-8">
          {loading && <Loader2 size={16} className="animate-spin" />} Track
        </button>
      </form>
      {error ? (
        <p id="order-id-error" className="field-error" role="alert">
          {error}
        </p>
      ) : (
        <p id="order-id-hint" className="mt-2 text-[13px] text-muted">
          Try a sample order: {sampleOrders.slice(0, 3).map((o, i) => (
            <span key={o.id}>
              {i > 0 && ", "}
              <button type="button" className="font-semibold text-ink underline underline-offset-2" onClick={() => router.replace(`/track-order?id=${o.id}`)}>
                {o.id}
              </button>
            </span>
          ))}
        </p>
      )}

      {hydrated && initialId && (
        <div className="mt-10" aria-live="polite">
          {order ? (
            <section className="rounded-2xl border border-line p-5 sm:p-7">
              <div className="mb-7 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-muted">Order #{order.id}</p>
                  <h2 className="mt-0.5 text-xl font-semibold">{order.status}</h2>
                  <p className="text-sm text-muted">
                    {order.items.reduce((n, i) => n + i.quantity, 0)} items · {formatPrice(order.total)} · placed {formatDate(order.createdAt)}
                  </p>
                </div>
                <Link href={`/account/orders/${order.id}`} className="btn-outline min-h-10 px-5 text-[13px]">
                  Order details
                </Link>
              </div>
              <OrderTimeline order={order} />
              <p className="mt-8 rounded-xl bg-canvas px-4 py-3 text-xs text-muted">
                Tracking shown here is sample data for this demo store; it is not connected to a courier.
              </p>
            </section>
          ) : (
            <div className="rounded-2xl bg-canvas px-6 py-12 text-center">
              <PackageSearch size={36} className="mx-auto text-accent" />
              <h2 className="mt-4 text-lg font-semibold">We couldn&apos;t find order #{initialId}</h2>
              <p className="mt-1 text-sm text-muted">Check the ID in your confirmation, or contact us for help.</p>
              <Link href="/contact" className="btn-outline mt-5">
                Contact support
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
