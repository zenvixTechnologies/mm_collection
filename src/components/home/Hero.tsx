"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Star } from "lucide-react";
import { IMG, portrait } from "@/data/images";
import { getProductBySlug } from "@/data/products";
import { formatPrice } from "@/lib/utils";
import { ProductImage } from "@/components/ui/ProductImage";

const ease = [0.22, 1, 0.36, 1] as const;
/** The dress in the main hero photo — tagged so shoppers can tap straight through. */
const featured = getProductBySlug("floral-maxi-dress");

export function Hero() {
  return (
    <section aria-labelledby="hero-heading" className="bg-sand bg-[radial-gradient(60%_80%_at_85%_10%,rgb(201_165_76/0.22),transparent_70%),radial-gradient(50%_60%_at_0%_100%,rgb(179_18_27/0.06),transparent_70%)]">
      <div className="container-page grid items-center gap-8 py-10 sm:py-12 lg:grid-cols-[1.05fr_1fr] lg:gap-12 lg:py-14">
        <div className="order-2 lg:order-1">
          <motion.p
            className="eyebrow"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease }}
          >
            The Festive Edit · 2026
          </motion.p>
          <motion.h1
            id="hero-heading"
            className="mt-3 font-display text-[44px] leading-[1.05] font-semibold sm:text-6xl lg:text-[68px]"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.08, ease }}
          >
            Dressed for every
            <br className="hidden sm:block" /> <em className="text-accent not-italic sm:italic">beautiful</em> moment
          </motion.h1>
          <motion.p
            className="mt-5 max-w-md text-[16px] leading-7 text-muted"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.16, ease }}
          >
            Kurtis, dresses, silk sarees and easy everyday wear — handpicked for comfort, quality and a perfect fit.
          </motion.p>
          <motion.div
            className="mt-8 flex flex-wrap gap-3"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.24, ease }}
          >
            <Link href="/shop" className="btn-primary group min-h-12 px-7">
              Shop Now
              <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link href="/categories" className="btn-outline min-h-12 bg-transparent px-7">
              Explore Collection
            </Link>
          </motion.div>
          <motion.dl
            className="mt-10 flex gap-8 text-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.4 }}
          >
            <div>
              <dt className="text-muted">Happy customers</dt>
              <dd className="font-display text-2xl font-semibold">12,000+</dd>
            </div>
            <div>
              <dt className="text-muted">Average rating</dt>
              <dd className="flex items-center gap-1 font-display text-2xl font-semibold">
                4.7 <Star size={16} className="text-gold" fill="currentColor" strokeWidth={0} />
              </dd>
            </div>
            <div className="hidden sm:block">
              <dt className="text-muted">Styles</dt>
              <dd className="font-display text-2xl font-semibold">40+</dd>
            </div>
          </motion.dl>
        </div>

        <motion.div
          className="order-1 grid grid-cols-[1.25fr_1fr] gap-3 sm:gap-4 lg:order-2"
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, ease }}
        >
          <div className="relative row-span-2 h-[300px] overflow-hidden rounded-2xl sm:h-[460px] lg:h-[500px]">
            <ProductImage
              src={portrait(IMG.blushMaxiDress)}
              alt="Woman wearing a flowing blush floral maxi dress"
              fill
              priority
              sizes="(min-width: 1024px) 30vw, 55vw"
            />
            {featured && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.6, ease }}
                className="absolute inset-x-2.5 bottom-2.5 sm:inset-x-auto sm:bottom-4 sm:left-4"
              >
                <Link
                  href={`/product/${featured.slug}`}
                  className="group flex items-center gap-3 rounded-xl bg-white/92 px-3 py-2.5 shadow-[var(--shadow-card)] backdrop-blur transition-colors hover:bg-white sm:px-4"
                >
                  <span className="min-w-0 leading-tight">
                    <span className="block truncate text-[12.5px] font-semibold text-ink sm:text-[13.5px]">{featured.name}</span>
                    <span className="mt-0.5 block text-xs text-muted">
                      <span className="font-semibold text-ink">{formatPrice(featured.price)}</span>
                      <span className="ml-1.5 hidden line-through sm:inline">{formatPrice(featured.originalPrice)}</span>
                    </span>
                  </span>
                  <span className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-transform group-hover:translate-x-0.5 sm:flex">
                    <ArrowRight size={15} />
                  </span>
                </Link>
              </motion.div>
            )}
          </div>
          <div className="relative h-[144px] overflow-hidden rounded-2xl sm:h-[222px] lg:h-[242px]">
            <ProductImage
              src={portrait(IMG.greenKurti)}
              alt="Woman in a green printed ethnic kurti"
              fill
              priority
              sizes="(min-width: 1024px) 22vw, 42vw"
            />
          </div>
          <Link
            href="/new-arrivals"
            className="group relative flex h-[144px] flex-col justify-end overflow-hidden rounded-2xl bg-ink p-4 text-white sm:h-[222px] lg:h-[242px]"
          >
            <ProductImage
              src={portrait(IMG.redSilkSaree)}
              alt=""
              fill
              sizes="(min-width: 1024px) 22vw, 42vw"
              className="opacity-70 transition-transform duration-700 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
            <span className="relative text-xs font-semibold tracking-widest uppercase">Just in</span>
            <span className="relative flex items-center gap-1 font-display text-xl font-semibold sm:text-2xl">
              New Arrivals <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
            </span>
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
