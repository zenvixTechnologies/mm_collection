"use client";

import type { CheckoutQuote, CheckoutSource, PaymentMethod, PlacedOrder, PublicCoupon, StoreOrder } from "@/types";
import type { PaginationMeta } from "@/types/api";
import { ApiError } from "./api-client";
import { customerApi } from "./customer-api";

/**
 * Browser calls for checkout and orders. Every price, discount and total comes back from the
 * server — the browser only says what to buy, for whom and where to.
 */

/**
 * customerApi refreshes an expired customer session itself. If that fails the session cookies
 * are cleared, so one retry continues as a guest instead of showing an error.
 */
async function call<T>(path: string, init: Parameters<typeof customerApi>[1] = {}) {
  try {
    return await customerApi<T>(path, init);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && err.code === "TOKEN_EXPIRED") return customerApi<T>(path, init);
    throw err;
  }
}

export async function fetchQuote(
  source: CheckoutSource,
  couponCode: string | null,
  opts: { expectedPrices?: Record<string, number>; signal?: AbortSignal } = {},
) {
  const { data } = await call<CheckoutQuote>("/checkout/validate", {
    method: "POST",
    body: { source, couponCode, expectedPrices: opts.expectedPrices },
    signal: opts.signal,
  });
  return data;
}

export interface PlaceOrderRequest {
  source: CheckoutSource;
  couponCode: string | null;
  customer: { fullName: string; email: string; mobile: string };
  address?: { house: string; street: string; city: string; district: string; state: string; pincode: string; country: "India" };
  addressId?: string;
  paymentMethod: Exclude<PaymentMethod, "cod">;
  idempotencyKey: string;
  expectedTotalPaise: number;
}

export async function placeOrder(body: PlaceOrderRequest) {
  return (await call<PlacedOrder>("/checkout/orders", { method: "POST", body })).data;
}

/** A random key per checkout attempt, so a repeated submit returns the same order. */
export function newIdempotencyKey() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let couponsPromise: Promise<PublicCoupon[]> | null = null;

/** Advertised coupons (cached for the page's lifetime; failures are retried next time). */
export function fetchPublicCoupons() {
  couponsPromise ??= call<PublicCoupon[]>("/coupons")
    .then((r) => r.data)
    .catch((err) => {
      couponsPromise = null;
      throw err;
    });
  return couponsPromise;
}

/** One order: the signed-in customer's own, or a guest order this browser holds the token for. */
export async function fetchOrder(id: string, token?: string | null, signal?: AbortSignal) {
  const { data } = await call<StoreOrder>(`/orders/${encodeURIComponent(id)}`, {
    headers: token ? { "X-Order-Token": token } : undefined,
    signal,
  });
  return data;
}

export async function fetchMyOrders(page: number, limit = 10): Promise<{ orders: StoreOrder[]; pagination: PaginationMeta | undefined }> {
  const { data, pagination } = await call<StoreOrder[]>(`/orders?page=${page}&limit=${limit}`);
  return { orders: data, pagination };
}
