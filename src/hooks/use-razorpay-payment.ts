"use client";

import { useCallback, useRef, useState } from "react";
import type { PaymentMethod } from "@/types";
import { ApiError, errorMessage } from "@/lib/api-client";
import { startPayment, verifyPayment } from "@/lib/checkout-api";
import { DOMESTIC_ONLY_CONFIG, loadRazorpay, openRazorpay } from "@/lib/razorpay/checkout";
import { SITE } from "@/lib/utils";
import { toast } from "@/store/ui-store";

export type PaymentOutcome = "paid" | "processing" | "failed" | "dismissed" | "expired" | "error";

/**
 * Pays a stored order with Razorpay Checkout:
 * 1. the server creates (or reuses) a Razorpay order for the order's stored total;
 * 2. Checkout opens with that Razorpay order ID — only one window at a time;
 * 3. Razorpay's success callback goes to the server, which verifies the signature and re-reads the
 *    payment from Razorpay before marking the order paid. The browser never decides "paid".
 *
 * Closing the window is not treated as a failure: the order stays reserved and the caller asks
 * the server what really happened.
 */
export function useRazorpayPayment() {
  const busy = useRef(false);
  const [paying, setPaying] = useState(false);

  const pay = useCallback(
    async (
      orderId: string,
      { token = null, retry = false, method }: { token?: string | null; retry?: boolean; method?: Exclude<PaymentMethod, "cod"> } = {},
    ): Promise<PaymentOutcome> => {
      if (busy.current) return "processing";
      busy.current = true;
      setPaying(true);
      try {
        let start;
        try {
          start = await startPayment(orderId, token, { retry });
        } catch (err) {
          if (err instanceof ApiError && err.code === "ALREADY_PAID") return "paid";
          toast.error(errorMessage(err));
          return err instanceof ApiError && err.code === "ORDER_EXPIRED" ? "expired" : "error";
        }
        if (!(await loadRazorpay())) {
          toast.error("Couldn't load the payment window. Check your connection and try again.");
          return "error";
        }

        return await new Promise<PaymentOutcome>((resolve) => {
          let settled = false;
          const done = (outcome: PaymentOutcome) => {
            if (!settled) {
              settled = true;
              resolve(outcome);
            }
          };
          try {
            openRazorpay(
              {
                key: start.keyId,
                amount: start.amountPaise,
                currency: "INR",
                order_id: start.razorpayOrderId,
                name: SITE.name,
                description: `Order ${start.orderId}`,
                prefill: { ...start.prefill, ...(method ? { method } : {}) },
                notes: { store_order_id: start.orderId },
                theme: { color: "#b3121b" },
                config: DOMESTIC_ONLY_CONFIG,
                timeout: start.timeoutSeconds,
                modal: { ondismiss: () => done("dismissed"), confirm_close: true },
                handler: (res) => {
                  verifyPayment(start.orderId, token, res)
                    .then((v) => done(v.result))
                    .catch((err: unknown) => {
                      // The payment may still have gone through — the order page re-checks with the server.
                      toast.error(errorMessage(err));
                      done("error");
                    });
                },
              },
              // A failed attempt inside the window: Razorpay lets the customer try again there.
              (message) => toast.error(message),
            );
          } catch {
            toast.error("Couldn't open the payment window. Please try again.");
            done("error");
          }
        });
      } finally {
        busy.current = false;
        setPaying(false);
      }
    },
    [],
  );

  return { pay, paying };
}
