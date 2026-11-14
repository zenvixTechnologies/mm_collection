"use client";

import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useHydrated } from "@/hooks/use-hydrated";
import { useAdminSession } from "@/store/admin-store";
import { AdminHeader } from "./AdminHeader";
import { AdminSidebarContent } from "./AdminSidebar";

function AdminSplash() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas" aria-busy="true" aria-label="Loading admin panel">
      <Image src="/brand/logo-192.webp" alt="" width={72} height={72} unoptimized className="animate-pulse" />
    </div>
  );
}

function MobileNav({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => panelRef.current?.querySelector<HTMLElement>("a")?.focus(), 50);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <motion.div className="absolute inset-0 bg-ink/50 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} aria-hidden />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Admin navigation"
            className="absolute inset-y-0 left-0 w-[84%] max-w-[300px] shadow-[var(--shadow-pop)]"
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "tween", duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <AdminSidebarContent onNavigate={onClose} />
            <button
              type="button"
              onClick={onClose}
              className="absolute top-4 right-3 flex h-10 w-10 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
              aria-label="Close navigation"
            >
              <X size={20} />
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/**
 * Admin chrome: fixed royal sidebar on desktop, drawer on mobile, sticky header, ivory canvas.
 * MOCK GUARD — redirects to /admin/login when no demo admin session exists. Real protection
 * (server-side session check / middleware) arrives with the backend.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const hydrated = useHydrated();
  const user = useAdminSession((s) => s.user);
  const router = useRouter();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const closeNav = useCallback(() => setNavOpen(false), []);

  useEffect(() => {
    if (hydrated && !user) router.replace(`/admin/login?next=${encodeURIComponent(pathname)}`);
  }, [hydrated, user, router, pathname]);

  if (!hydrated || !user) return <AdminSplash />;

  return (
    <div className="min-h-dvh bg-canvas">
      <a
        href="#admin-main"
        className="sr-only z-[100] rounded-full bg-ink px-4 py-2 text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[264px] lg:block print:!hidden">
        <AdminSidebarContent />
      </aside>
      <MobileNav open={navOpen} onClose={closeNav} />
      <div className="min-w-0 lg:pl-[264px] print:pl-0">
        <AdminHeader onOpenMenu={() => setNavOpen(true)} />
        <main id="admin-main" className="mx-auto w-full max-w-[1440px] px-4 pt-6 pb-24 sm:px-6 lg:px-8 lg:pt-8">
          <Suspense fallback={null}>{children}</Suspense>
        </main>
      </div>
    </div>
  );
}
