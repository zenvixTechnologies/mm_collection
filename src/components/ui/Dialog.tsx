"use client";

import { AnimatePresence, motion, type TargetAndTransition } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Variant = "center" | "right" | "left" | "top" | "bottom-sheet";

const WIDTH: Record<"md" | "lg" | "xl", { center: string; right: string }> = {
  md: { center: "max-w-lg", right: "max-w-[420px]" },
  lg: { center: "max-w-2xl", right: "max-w-[560px]" },
  xl: { center: "max-w-4xl", right: "max-w-[720px]" },
};

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Hide the visible title (still announced to screen readers). */
  hideTitle?: boolean;
  variant?: Variant;
  className?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Width of centre dialogs and side drawers. Defaults to "md" (the original sizes). */
  size?: "md" | "lg" | "xl";
}

const panelMotion: Record<Variant, { initial: TargetAndTransition; animate: TargetAndTransition; exit: TargetAndTransition }> = {
  center: {
    initial: { opacity: 0, scale: 0.96, y: 12 },
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.97, y: 8 },
  },
  right: { initial: { x: "100%" }, animate: { x: 0 }, exit: { x: "100%" } },
  left: { initial: { x: "-100%" }, animate: { x: 0 }, exit: { x: "-100%" } },
  top: { initial: { y: "-100%" }, animate: { y: 0 }, exit: { y: "-100%" } },
  "bottom-sheet": { initial: { y: "100%" }, animate: { y: 0 }, exit: { y: "100%" } },
};

const panelClass: Record<Variant, string> = {
  center:
    "relative m-auto flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] flex-col overflow-hidden rounded-2xl bg-white shadow-[var(--shadow-pop)]",
  right: "ml-auto flex h-full w-full flex-col bg-white shadow-[var(--shadow-pop)]",
  left: "mr-auto flex h-full w-[86%] max-w-[360px] flex-col bg-white shadow-[var(--shadow-pop)]",
  top: "flex w-full flex-col bg-white shadow-[var(--shadow-pop)]",
  "bottom-sheet":
    "mt-auto flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-[var(--shadow-pop)] sm:m-auto sm:max-w-lg sm:rounded-2xl",
};

/**
 * Accessible modal / drawer: traps focus, closes on Escape and backdrop click,
 * locks body scroll and restores focus to the trigger on close.
 */
export function Dialog({ open, onClose, title, hideTitle, variant = "center", className, children, footer, size = "md" }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    document.body.style.paddingRight = scrollbar ? `${scrollbar}px` : "";

    const focusFirst = window.setTimeout(() => {
      const el = panelRef.current?.querySelector<HTMLElement>("[data-autofocus]") ?? panelRef.current;
      el?.focus();
    }, 30);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(focusFirst);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      document.body.style.paddingRight = "";
      previouslyFocused?.focus?.();
    };
  }, [open]);

  const m = panelMotion[variant];

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex">
          <motion.div
            className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className={cn(
              panelClass[variant],
              variant === "center" && WIDTH[size].center,
              variant === "right" && WIDTH[size].right,
              "z-10 focus:outline-none",
              className,
            )}
            initial={m.initial}
            animate={m.animate}
            exit={m.exit}
            transition={{ type: "tween", duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className={cn("flex items-center justify-between gap-4 px-5 py-4", !hideTitle && "border-b border-line")}>
              <h2 id={titleId} className={cn("text-lg font-semibold", hideTitle && "sr-only")}>
                {title}
              </h2>
              <button type="button" onClick={onClose} className="icon-btn -mr-2 ml-auto" aria-label="Close">
                <X size={20} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
            {footer && <div className="border-t border-line px-5 py-4">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
