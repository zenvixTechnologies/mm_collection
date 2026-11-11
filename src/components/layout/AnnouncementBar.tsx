"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { offers } from "@/data/offers";

export function AnnouncementBar() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % offers.length), 5000);
    return () => clearInterval(t);
  }, [paused]);

  const offer = offers[index];
  const go = (d: number) => setIndex((i) => (i + d + offers.length) % offers.length);

  return (
    <div
      className="bg-gradient-to-r from-royal via-accent-dark to-royal text-white"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="container-page flex h-9 items-center justify-between gap-2 text-[12.5px]">
        <button type="button" onClick={() => go(-1)} aria-label="Previous announcement" className="rounded-full p-1 text-white/70 hover:text-white">
          <ChevronLeft size={15} />
        </button>
        <div className="relative flex-1 overflow-hidden text-center" aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={offer.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
              className="truncate"
            >
              <Link href={offer.href} className="hover:underline underline-offset-2">
                <span className="font-semibold">{offer.title}</span>
                <span className="hidden text-white/70 sm:inline"> · {offer.subtitle}</span>
              </Link>
            </motion.p>
          </AnimatePresence>
        </div>
        <button type="button" onClick={() => go(1)} aria-label="Next announcement" className="rounded-full p-1 text-white/70 hover:text-white">
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}
