"use client";

import { useMemo } from "react";
import { sampleOrders, DEMO_USER } from "@/data/orders";
import { useCurrentUser } from "@/store/auth-store";
import { useOrderStore } from "@/store/order-store";

/**
 * Orders visible in "My Orders":
 * - signed in: orders placed on this device with the account's email (+ sample history for the demo account)
 * - guest: every order placed on this device
 */
export function useMyOrders() {
  const placed = useOrderStore((s) => s.orders);
  const user = useCurrentUser();
  return useMemo(() => {
    const mine = user
      ? placed.filter((o) => o.customer.email.toLowerCase() === user.email.toLowerCase())
      : placed;
    const extra = user?.id === DEMO_USER.id ? sampleOrders : [];
    return [...mine, ...extra].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }, [placed, user]);
}
