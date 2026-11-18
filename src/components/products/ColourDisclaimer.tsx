"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Info, X } from "lucide-react";
import { useCallback, useId, useRef, useState } from "react";
import { useDismiss } from "@/hooks/use-dismiss";
import { cn } from "@/lib/utils";

/** The store's colour disclaimer — the single source for its wording. */
export const COLOUR_DISCLAIMER = {
  title: "Colour Disclaimer",
  paragraphs: [
    "We make every effort to display product images as accurately as possible. However, slight colour variations may occur due to lighting conditions, photography, screen brightness, and device display settings.",
    "The actual product colour may vary slightly from the images shown on our website. We recommend considering this before placing your order.",
    "Thank you for understanding!",
  ],
} as const;

function DisclaimerText({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {COLOUR_DISCLAIMER.paragraphs.map((text) => (
        <p key={text}>{text}</p>
      ))}
    </div>
  );
}

/** Subtle information section for the product detail page. */
export function ColourDisclaimer({ className }: { className?: string }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cn("flex items-start gap-3 rounded-xl bg-canvas px-4 py-3.5", className)}>
      <Info size={16} className="mt-0.5 shrink-0 text-gold-dark" aria-hidden />
      <div className="min-w-0 text-[13px] leading-5 text-muted">
        <h2 id={headingId} className="mb-1 text-sm font-semibold text-ink">
          {COLOUR_DISCLAIMER.title}
        </h2>
        <DisclaimerText />
      </div>
    </section>
  );
}

/**
 * Small "i" button that sits over the product photo and opens the disclaimer in a light popover.
 * Click / tap to toggle; closes on outside tap, Escape or the close button. Must be placed inside a
 * positioned container (it anchors to the top-right corner).
 */
export function ColourInfoButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  return (
    <div ref={ref} className={cn("absolute top-3 right-3 z-10 flex flex-col items-end", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="About product colours"
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-full shadow-sm transition-colors",
          open ? "bg-ink text-white" : "bg-white/90 text-ink hover:bg-white",
        )}
      >
        <Info size={17} aria-hidden />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={panelId}
            role="dialog"
            aria-label={COLOUR_DISCLAIMER.title}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16 }}
            className="mt-2 w-72 max-w-[calc(100vw-3.5rem)] rounded-xl border border-line bg-white p-4 text-left shadow-[var(--shadow-pop)]"
          >
            <div className="mb-1.5 flex items-start justify-between gap-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Info size={15} className="text-gold-dark" aria-hidden />
                {COLOUR_DISCLAIMER.title}
              </p>
              <button type="button" onClick={close} className="-mt-1 -mr-1 rounded-full p-1 text-muted hover:text-ink" aria-label="Close colour disclaimer">
                <X size={15} />
              </button>
            </div>
            <DisclaimerText className="text-[13px] leading-5 text-muted" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
