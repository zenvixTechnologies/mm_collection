"use client";

import { MotionConfig } from "framer-motion";
import { useEffect, type ReactNode } from "react";
import { SESSION_FLAG, useAuthStore } from "@/store/auth-store";

export function Providers({ children }: { children: ReactNode }) {
  // Mock "remember me": if the user didn't ask to be remembered, end the
  // session once the browser session (tab/window) is closed.
  useEffect(() => {
    const { currentUserId, remember, logout } = useAuthStore.getState();
    try {
      if (currentUserId && !remember && !sessionStorage.getItem(SESSION_FLAG)) logout();
      if (useAuthStore.getState().currentUserId) sessionStorage.setItem(SESSION_FLAG, "1");
    } catch {
      /* storage unavailable */
    }
  }, []);

  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
