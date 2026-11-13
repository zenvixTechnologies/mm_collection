"use client";

/** Browser-side helpers for Razorpay Standard Checkout (domestic payments only). */

const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

export interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayFailure {
  error: { description?: string; reason?: string };
}

export interface RazorpayOptions {
  key: string;
  amount: number;
  currency: "INR";
  order_id: string;
  name: string;
  description?: string;
  image?: string;
  prefill?: { name?: string; email?: string; contact?: string; method?: "upi" | "card" | "netbanking" };
  notes?: Record<string, string>;
  theme?: { color?: string };
  config?: unknown;
  modal?: { ondismiss?: () => void; confirm_close?: boolean };
  handler: (res: RazorpaySuccess) => void;
}

interface RazorpayInstance {
  open: () => void;
  on: (event: "payment.failed", cb: (res: RazorpayFailure) => void) => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

let loading: Promise<boolean> | null = null;

export function loadRazorpay(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  loading ??= new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => resolve(!!window.Razorpay);
    s.onerror = () => {
      loading = null;
      resolve(false);
    };
    document.body.appendChild(s);
  });
  return loading;
}

/**
 * Show only the domestic methods we support — UPI, cards and net banking — and hide wallets,
 * EMI and pay-later. International cards are additionally rejected on the server.
 */
export const DOMESTIC_ONLY_CONFIG = {
  display: {
    hide: [{ method: "wallet" }, { method: "emi" }, { method: "cardless_emi" }, { method: "paylater" }],
    preferences: { show_default_blocks: true },
  },
};

export function openRazorpay(options: RazorpayOptions, onFailed: (message: string) => void) {
  if (!window.Razorpay) throw new Error("Razorpay is not loaded");
  const rzp = new window.Razorpay(options);
  rzp.on("payment.failed", (res) => onFailed(res.error?.description || "Payment failed. Please try again."));
  rzp.open();
}
