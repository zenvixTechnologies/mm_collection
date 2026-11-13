"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Check, Copy, PackageSearch } from "lucide-react";
import { useHydrated } from "@/hooks/use-hydrated";
import { formatDate, formatPrice } from "@/lib/utils";
import { findOrder, useOrderStore } from "@/store/order-store";
import { toast } from "@/store/ui-store";
import { AddressBlock, OrderItems, OrderTotals, PAYMENT_LABEL } from "@/components/account/OrderParts";
import { EmptyState } from "@/components/ui/EmptyState";

export function OrderSuccessView({ id }: { id: string }) {
  const hydrated = useHydrated();
  const orders = useOrderStore((s) => s.orders);
  const order = hydrated && id ? findOrder(orders, id) : null;

  if (!hydrated) {
    return (
      <div className="container-page max-w-3xl py-16">
        <div className="skeleton mx-auto h-20 w-20 rounded-full" />
        <div className="skeleton mx-auto mt-6 h-8 w-2/3" />
        <div className="skeleton mt-10 h-64 rounded-2xl" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="container-page">
        <EmptyState
          icon={<PackageSearch size={40} />}
          title="Order not found"
          description="We couldn't find that order on this device. You can look it up from the order tracking page."
          actionLabel="Track an order"
          actionHref="/track-order"
        />
      </div>
    );
  }

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(order.id);
      toast.success("Order ID copied");
    } catch {
      toast.info(`Your order ID is ${order.id}`);
    }
  };

  return (
    <div className="container-page max-w-3xl pt-10 sm:pt-14">
      <div className="text-center">
        <motion.div
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 16 }}
          className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-success text-white shadow-[0_10px_30px_rgb(47_125_79/0.35)]"
        >
          <Check size={38} strokeWidth={2.6} />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <h1 className="mt-6 font-display text-4xl font-semibold sm:text-5xl">Thank you for your order!</h1>
          <p className="mx-auto mt-3 max-w-md text-muted">
            Your order has been placed, {order.customer.fullName.split(" ")[0]}. A confirmation would be sent to{" "}
            <strong className="text-ink">{order.customer.email}</strong>.
          </p>
          {order.payment ? (
            <p className="mx-auto mt-3 max-w-md text-xs text-muted">
              Paid {formatPrice(order.payment.amount)} via Razorpay · Payment ID {order.payment.razorpayPaymentId}
              {order.payment.mode === "test" && " · Test Mode — no real money was charged"}
            </p>
          ) : null}
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className="mt-10 overflow-hidden rounded-2xl border border-line"
      >
        <dl className="grid grid-cols-2 gap-px bg-line text-sm sm:grid-cols-4">
          <Info label="Order ID">
            <button type="button" onClick={copyId} className="inline-flex items-center gap-1.5 font-semibold tracking-wide hover:text-accent" aria-label={`Copy order ID ${order.id}`}>
              {order.id} <Copy size={13} />
            </button>
          </Info>
          <Info label="Order date">{formatDate(order.createdAt, true)}</Info>
          <Info label="Payment">{PAYMENT_LABEL[order.paymentMethod]}</Info>
          <Info label="Total amount">
            <span className="font-semibold">{formatPrice(order.total)}</span>
          </Info>
        </dl>
        <div className="grid gap-8 p-5 sm:p-6 md:grid-cols-[1fr_240px]">
          <div>
            <h2 className="mb-4 text-base font-semibold">Items ordered</h2>
            <OrderItems order={order} />
          </div>
          <div className="space-y-6">
            <div>
              <h2 className="mb-2 text-base font-semibold">Delivering to</h2>
              <AddressBlock order={order} />
            </div>
            <div className="rounded-xl bg-canvas p-4">
              <OrderTotals order={order} />
            </div>
          </div>
        </div>
      </motion.div>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Link href="/shop" className="btn-primary min-h-12 px-8">
          Continue Shopping
        </Link>
        <Link href="/account/orders" className="btn-outline min-h-12 px-8">
          View My Orders
        </Link>
        <Link href={`/track-order?id=${order.id}`} className="btn-ghost min-h-12 px-8">
          Track Order
        </Link>
      </div>
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-canvas px-4 py-3.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
