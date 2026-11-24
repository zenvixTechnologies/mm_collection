"use client";

import { MotionConfig } from "framer-motion";
import { useEffect, type ReactNode } from "react";
import { useAuthStore } from "@/store/auth-store";

export function Providers({ children }: { children: ReactNode }) {
  // Restore the customer's session from its HttpOnly cookies (no-op for guests).
  useEffect(() => {
    void useAuthStore.getState().load();
  }, []);

  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
