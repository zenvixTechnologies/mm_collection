"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpDown, Check } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { SORT_OPTIONS, type SortValue } from "@/lib/catalog";
import { cn } from "@/lib/utils";

export function SortSelect({ value, onChange }: { value: SortValue; onChange: (v: SortValue) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = SORT_OPTIONS.find((o) => o.value === value) ?? SORT_OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        className="flex h-11 items-center gap-2 rounded-full border border-line bg-white px-4 text-sm font-medium transition-colors hover:border-ink"
      >
        <ArrowUpDown size={15} />
        <span className="hidden text-muted sm:inline">Sort:</span>
        <span className="max-w-[110px] truncate sm:max-w-none">{current.label}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            id={listId}
            role="listbox"
            aria-label="Sort products"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="absolute right-0 z-30 mt-2 w-60 origin-top-right rounded-xl border border-line bg-white p-1.5 shadow-[var(--shadow-pop)]"
          >
            {SORT_OPTIONS.map((o) => {
              const selected = o.value === value;
              return (
                <li key={o.value} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-sand",
                      selected && "font-semibold",
                    )}
                  >
                    {o.label}
                    {selected && <Check size={15} className="text-accent" />}
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
