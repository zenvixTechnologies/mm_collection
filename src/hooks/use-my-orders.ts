"use client";

import { useMemo } from "react";
import { useCurrentUser } from "@/store/auth-store";
import { useOrderStore } from "@/store/order-store";

/**
 * Orders visible in "My Orders" (until order history moves to the server):
 * - signed in: orders placed on this device with the account's email
 * - guest: every order placed on this device
 */
export function useMyOrders() {
  const placed = useOrderStore((s) => s.orders);
  const user = useCurrentUser();
  return useMemo(() => {
    const mine = user
      ? placed.filter((o) => o.customer.email.toLowerCase() === user.email.toLowerCase())
      : placed;
    return [...mine].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }, [placed, user]);
}
