"use client";

import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Quote } from "lucide-react";
import { useRef } from "react";
import { testimonials } from "@/data/reviews";
import { formatDate } from "@/lib/utils";
import { Rating } from "@/components/ui/Rating";

export function Testimonials() {
  const track = useRef<HTMLUListElement>(null);
  const scroll = (dir: number) => {
    const el = track.current;
    if (!el) return;
    el.scrollBy({ left: dir * (el.clientWidth * 0.8), behavior: "smooth" });
  };

  return (
    <div>
      <div className="mb-6 flex justify-end gap-2">
        <button type="button" onClick={() => scroll(-1)} className="icon-btn border border-line" aria-label="Previous reviews">
          <ChevronLeft size={18} />
        </button>
        <button type="button" onClick={() => scroll(1)} className="icon-btn border border-line" aria-label="Next reviews">
          <ChevronRight size={18} />
        </button>
      </div>
      <ul
        ref={track}
        className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:scroll-px-0 sm:px-0"
        aria-label="Customer reviews"
      >
        {testimonials.map((t, i) => (
          <motion.li
            key={t.id}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.45, delay: Math.min(i, 3) * 0.06 }}
            className="flex w-[85%] shrink-0 snap-start flex-col rounded-2xl border border-line bg-white p-6 sm:w-[46%] lg:w-[31.5%]"
          >
            <div className="flex items-center justify-between">
              <Rating value={t.rating} size={15} />
              <Quote size={22} className="text-gold/60" />
            </div>
            <p className="mt-4 font-semibold">{t.title}</p>
            <p className="mt-2 flex-1 text-[14.5px] leading-7 text-muted">&ldquo;{t.comment}&rdquo;</p>
            <div className="mt-5 flex items-center gap-3 border-t border-line pt-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-sand font-semibold text-accent" aria-hidden>
                {t.name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")}
              </span>
              <div className="min-w-0 text-sm">
                <p className="font-medium">{t.name}</p>
                <p className="truncate text-xs text-muted">
                  {t.location} · {formatDate(t.date)}
                  {t.productName && ` · ${t.productName}`}
                </p>
              </div>
            </div>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}
