"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useToastStore } from "@/store/ui-store";
import { cn } from "@/lib/utils";

const icons = {
  success: <CheckCircle2 size={18} className="text-success" />,
  error: <AlertCircle size={18} className="text-danger" />,
  info: <Info size={18} className="text-accent" />,
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-20 z-[80] flex flex-col items-center gap-2 px-4 lg:bottom-6"
      aria-live="polite"
      role="status"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.22 }}
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl border border-line bg-white px-4 py-3 text-sm shadow-[var(--shadow-pop)]",
            )}
          >
            <span className="shrink-0">{icons[t.tone]}</span>
            <p className="flex-1 text-ink">{t.message}</p>
            {t.action && (
              <Link
                href={t.action.href}
                onClick={() => dismiss(t.id)}
                className="shrink-0 text-sm font-semibold text-accent underline-offset-2 hover:underline"
              >
                {t.action.label}
              </Link>
            )}
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="-mr-1 shrink-0 rounded-full p-1 text-muted hover:bg-sand hover:text-ink"
              aria-label="Dismiss notification"
            >
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
