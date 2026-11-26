"use client";

import { MotionConfig } from "framer-motion";
import { useEffect, type ReactNode } from "react";
import { useAuthStore } from "@/store/auth-store";
import { useCartStore } from "@/store/cart-store";
import { useWishlistStore } from "@/store/wishlist-store";

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Restore the customer's session from its HttpOnly cookies (no-op for guests).
    void useAuthStore.getState().load();
    return syncShopperData();
  }, []);

  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/**
 * Keeps the bag and wishlist in step with who is shopping. Once the session is known — and
 * again whenever someone signs in, out or switches account — they are reloaded from the server.
 * On sign-in the guest bag/wishlist from this browser is merged into the account.
 */
function syncShopperData() {
  let last: string | null = null;
  const run = (status: string, userId: string | undefined) => {
    if (status === "unknown") return;
    const who = status === "authenticated" ? `user:${userId}` : "guest";
    if (who === last) return;
    last = who;
    // Merging on every authenticated load is cheap and also catches a sign-in made in another tab.
    const mode = who === "guest" ? "load" : "merge";
    void useCartStore.getState().sync(mode);
    void useWishlistStore.getState().sync(mode);
  };
  const { status, user } = useAuthStore.getState();
  run(status, user?.id);
  return useAuthStore.subscribe((s) => run(s.status, s.user?.id));
}
