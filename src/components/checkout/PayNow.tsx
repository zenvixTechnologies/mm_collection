"use client";

import Link from "next/link";
import { Clock, Loader2, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import type { StoreOrder } from "@/types";
import { useRazorpayPayment } from "@/hooks/use-razorpay-payment";
import { fetchPaymentStatus } from "@/lib/checkout-api";
import { formatDate, formatPrice } from "@/lib/utils";
import { guestTokenFor } from "@/store/order-store";
import { toast } from "@/store/ui-store";

const MIN_LEFT_MS = 60_000;

/**
 * Payment panel for an order that is waiting for payment: pay (or try again) through Razorpay
 * while its items are reserved. The amount is the order's stored total, set by the server.
 */
export function PayNow({ order, onChange }: { order: StoreOrder; onChange: () => void }) {
  const { pay, paying } = useRazorpayPayment();
  const [checking, setChecking] = useState(false);
  const pending = order.status === "Payment Pending";

  // Ask the server (which asks Razorpay) whether a payment already went through — e.g. the window
  // was closed or the connection dropped right after paying.
  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    fetchPaymentStatus(order.id, guestTokenFor(order.id), { refresh: true })
      // Reload the order whenever Razorpay's answer differs from what's shown (paid, or a failed
      // attempt → "Try again").
      .then((s) => !cancelled && (s.paymentState !== (order.paymentState ?? "pending") || s.status !== order.status) && onChange())
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per order
  }, [order.id, pending]);

  if (!pending) return null;
  const until = order.reservedUntil ? new Date(order.reservedUntil) : null;
  const open = !!until && until.getTime() - Date.now() > MIN_LEFT_MS;

  const run = async () => {
    const token = guestTokenFor(order.id);
    const outcome = await pay(order.id, {
      token,
      retry: order.paymentState === "failed",
      method: order.paymentMethod === "cod" ? undefined : order.paymentMethod,
    });
    if (outcome === "dismissed" || outcome === "error") {
      setChecking(true);
      const s = await fetchPaymentStatus(order.id, token, { refresh: true }).catch(() => null);
      setChecking(false);
      if (s?.paymentState !== "paid" && outcome === "dismissed") {
        toast.info(`Payment not completed. Your items stay reserved${until ? ` until ${formatDate(until.toISOString(), true)}` : ""}.`);
      }
    } else if (outcome === "processing") {
      toast.info("Your payment is being processed. We'll confirm your order as soon as it completes.");
    } else if (outcome === "failed") {
      toast.error("The payment didn't go through. You can try again.");
    }
    onChange();
  };

  return (
    <div className="mt-6 rounded-xl border border-dashed border-warning bg-[#fdf6ea] px-4 py-4 text-sm">
      {open ? (
        <>
          <p className="flex items-start gap-2">
            <Clock size={16} className="mt-0.5 shrink-0 text-warning" />
            <span>
              {order.paymentState === "failed" ? "Your last payment attempt didn't go through. " : "This order is waiting for payment. "}
              Your items are reserved until <strong>{formatDate(order.reservedUntil!, true)}</strong>.
            </span>
          </p>
          <button type="button" onClick={() => void run()} disabled={paying || checking} className="btn-accent mt-4 min-h-12 w-full sm:w-auto sm:px-8">
            {paying || checking ? <Loader2 size={17} className="animate-spin" /> : <Lock size={15} />}
            {checking
              ? "Checking payment…"
              : paying
                ? "Processing payment…"
                : `${order.paymentState === "failed" ? "Try again" : "Pay"} · ${formatPrice(order.total)}`}
          </button>
          <p className="mt-2 text-xs text-muted">Secure payment by Razorpay · UPI, Indian cards and net banking · INR only</p>
        </>
      ) : (
        <p className="flex items-start gap-2">
          <Clock size={16} className="mt-0.5 shrink-0 text-warning" />
          <span>
            The time to pay for this order has run out and the items are being released.{" "}
            <Link href="/shop" className="font-semibold underline underline-offset-2">
              Place a new order
            </Link>{" "}
            to buy them.
          </span>
        </p>
      )}
    </div>
  );
}
