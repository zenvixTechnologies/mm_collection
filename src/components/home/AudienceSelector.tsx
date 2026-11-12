"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { AUDIENCES } from "@/data/audiences";
import { getProductsByAudience } from "@/data/products";
import { useAudienceStore } from "@/store/audience-store";
import { ProductImage } from "@/components/ui/ProductImage";

const ALT: Record<string, string> = {
  women: "Woman in a floral wrap dress",
  men: "Man in a navy slim-fit suit",
  kids: "Three smiling children sitting on a doorstep",
};

/**
 * "Who are you shopping for?" — Women / Men / Kids entry cards.
 * Women stays the widest card on desktop: it is the brand's main focus.
 */
export function AudienceSelector() {
  const setAudience = useAudienceStore((s) => s.setAudience);

  return (
    <ul className="grid grid-cols-3 gap-2.5 sm:gap-4 md:grid-cols-[1.35fr_1fr_1fr] md:gap-5">
      {AUDIENCES.map((a, i) => (
        <motion.li
          key={a.id}
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "0px 0px -60px 0px" }}
          transition={{ duration: 0.55, delay: i * 0.09, ease: [0.22, 1, 0.36, 1] }}
        >
          <Link
            href={a.href}
            onClick={() => setAudience(a.id)}
            className="group relative block overflow-hidden rounded-2xl bg-sand"
            aria-label={`Explore the ${a.title}`}
          >
            <div className="relative aspect-[3/4] md:aspect-auto md:h-[420px]">
              <ProductImage
                src={a.cardImage}
                alt={ALT[a.id]}
                fill
                sizes="(min-width: 768px) 40vw, 33vw"
                className="object-[center_20%] transition-transform duration-700 ease-out group-hover:scale-[1.06]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
            </div>
            <div className="absolute inset-x-0 bottom-0 p-3 text-white sm:p-6">
              <p className="hidden text-xs font-semibold tracking-[0.18em] text-white/80 uppercase sm:block">
                {getProductsByAudience(a.id).length} styles
              </p>
              <h3 className="font-display text-xl font-semibold text-white sm:mt-1 sm:text-4xl">{a.label}</h3>
              <span className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold underline-offset-4 group-hover:underline sm:mt-3 sm:gap-1.5 sm:text-sm">
                <span className="hidden sm:inline">Explore Collection</span>
                <span className="sm:hidden">Explore</span>
                <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" />
              </span>
            </div>
          </Link>
        </motion.li>
      ))}
    </ul>
  );
}
