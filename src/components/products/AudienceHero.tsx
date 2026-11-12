"use client";

import { motion } from "framer-motion";
import type { AudienceInfo } from "@/data/audiences";
import { ProductImage } from "@/components/ui/ProductImage";

interface AudienceHeroProps {
  info: Omit<AudienceInfo, "keywords">;
  productCount: number;
  /** Shown above the title — e.g. "Men's Collection" on a sub-category page. */
  eyebrow?: string;
  title?: string;
  description?: string;
  image?: string;
}

/** Banner at the top of the Women / Men / Kids collection and sub-category pages. */
export function AudienceHero({ info, productCount, eyebrow, title, description, image }: AudienceHeroProps) {
  return (
    <motion.header
      key={info.id + (title ?? "")}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="mt-4 mb-6 grid overflow-hidden rounded-[var(--radius-card)] bg-sand md:grid-cols-[1.15fr_1fr]"
    >
      <div className="order-2 flex flex-col justify-center p-6 sm:p-10 md:order-1">
        <p className="eyebrow">{eyebrow ?? `Shop ${info.label}`}</p>
        <h1 className="mt-2 font-display text-4xl font-semibold sm:text-5xl">{title ?? info.title}</h1>
        <p className="mt-3 max-w-md text-muted">{description ?? info.tagline}</p>
        <p className="mt-5 text-sm font-medium text-ink">
          {productCount} {productCount === 1 ? "style" : "styles"}
        </p>
      </div>
      <div className="relative order-1 h-56 overflow-hidden sm:h-72 md:order-2 md:h-auto md:min-h-[300px]">
        <motion.div
          className="absolute inset-0"
          initial={{ scale: 1.08 }}
          animate={{ scale: 1 }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
        >
          <ProductImage
            src={image ?? info.heroImage}
            alt=""
            fill
            priority
            sizes="(min-width: 768px) 45vw, 100vw"
            className="object-cover object-[center_25%]"
          />
        </motion.div>
      </div>
    </motion.header>
  );
}
