"use client";

import Link from "next/link";
import { motion, type Variants } from "framer-motion";
import { ArrowRight, Star } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { IMG, portrait } from "@/data/images";
import { getProductBySlug } from "@/data/products";
import { formatPrice } from "@/lib/utils";
import { useIntroStore } from "@/store/intro-store";
import { ProductImage } from "@/components/ui/ProductImage";

const EASE = [0.22, 1, 0.36, 1] as const;
/** The dress in the main hero photo — tagged so shoppers can tap straight through. */
const featured = getProductBySlug("floral-maxi-dress");

/**
 * Reveal choreography (seconds after the hand-off from <IntroAnimation />):
 *   0.10–1.05  photos unmask top→bottom (clip-path), following the intro curtain, with a slow zoom-out
 *   0.25       eyebrow
 *   0.35–0.95  headline lines rise from masks
 *   0.60       description
 *   0.85       Shop Now / Explore Collection
 *   1.00       stats + shoppable tag
 * Without an intro (return visits, client navigation) the same sequence runs ~2× faster.
 */
function useRevealTiming() {
  const heroReady = useIntroStore((s) => s.heroReady);
  const introPlayed = useIntroStore((s) => s.introPlayed);
  const reveal = useIntroStore((s) => s.reveal);
  // Was the hero already cleared to show when this component mounted (client navigation)?
  const [readyAtMount] = useState(() => useIntroStore.getState().heroReady);

  // Failsafe: if the intro never hands off (e.g. it errored), show the hero anyway.
  useEffect(() => {
    if (heroReady) return;
    const t = window.setTimeout(() => reveal(false), 3500);
    return () => window.clearTimeout(t);
  }, [heroReady, reveal]);

  const speed = introPlayed && !readyAtMount ? 1 : 0.5;
  return { state: heroReady ? "show" : "hidden", d: (s: number) => s * speed };
}

const rise = (delay: number, y = 18): Variants => ({
  hidden: { opacity: 0, y },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, delay, ease: EASE } },
});

/** Clip-path image reveal: the frame unmasks downward while the photo settles from a slight zoom. */
function RevealFrame({
  delay,
  state,
  className,
  children,
  overlay,
}: {
  delay: number;
  state: string;
  className: string;
  children: ReactNode;
  overlay?: ReactNode;
}) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate={state}
      variants={{
        hidden: { clipPath: "inset(0% 0% 100% 0% round 16px)" },
        show: { clipPath: "inset(0% 0% 0% 0% round 16px)", transition: { duration: 0.95, delay, ease: [0.65, 0, 0.35, 1] } },
      }}
    >
      <motion.div
        className="absolute inset-0"
        variants={{
          hidden: { scale: 1.18 },
          show: { scale: 1, transition: { duration: 1.4, delay, ease: EASE } },
        }}
      >
        {children}
      </motion.div>
      {overlay}
    </motion.div>
  );
}

/** One headline line rising out of its own mask. */
function MaskLine({ children, delay, state }: { children: ReactNode; delay: number; state: string }) {
  return (
    <span className="-mb-[0.12em] block overflow-hidden pb-[0.12em]">
      <motion.span
        className="block"
        initial="hidden"
        animate={state}
        variants={{
          hidden: { y: "105%" },
          show: { y: "0%", transition: { duration: 0.75, delay, ease: EASE } },
        }}
      >
        {children}
      </motion.span>
    </span>
  );
}

export function Hero() {
  const { state, d } = useRevealTiming();

  return (
    <section
      aria-labelledby="hero-heading"
      className="overflow-hidden bg-sand bg-[radial-gradient(60%_80%_at_85%_10%,rgb(201_165_76/0.22),transparent_70%),radial-gradient(50%_60%_at_0%_100%,rgb(179_18_27/0.06),transparent_70%)]"
    >
      <div className="container-page grid items-center gap-8 py-10 sm:py-12 lg:grid-cols-[1.05fr_1fr] lg:gap-12 lg:py-14">
        <div className="order-2 lg:order-1">
          <motion.p className="eyebrow" initial="hidden" animate={state} variants={rise(d(0.25), 12)}>
            The Festive Edit · 2026
          </motion.p>
          <h1 id="hero-heading" className="mt-3 font-display text-[44px] leading-[1.05] font-semibold sm:text-6xl lg:text-[68px]">
            <MaskLine delay={d(0.35)} state={state}>
              Dressed for every
            </MaskLine>
            <MaskLine delay={d(0.47)} state={state}>
              <em className="text-accent not-italic sm:italic">beautiful</em> moment
            </MaskLine>
          </h1>
          <motion.p
            className="mt-5 max-w-md text-[16px] leading-7 text-muted"
            initial="hidden"
            animate={state}
            variants={rise(d(0.6))}
          >
            Kurtis, dresses, silk sarees and easy everyday wear — handpicked for comfort, quality and a perfect fit.
          </motion.p>
          <motion.div className="mt-8 flex flex-wrap gap-3" initial="hidden" animate={state} variants={rise(d(0.85), 14)}>
            <Link href="/shop" className="btn-primary group min-h-12 px-7">
              Shop Now
              <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link href="/categories" className="btn-outline min-h-12 bg-transparent px-7">
              Explore Collection
            </Link>
          </motion.div>
          <motion.dl className="mt-10 flex gap-8 text-sm" initial="hidden" animate={state} variants={rise(d(1), 8)}>
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

        <div className="order-1 grid grid-cols-[1.25fr_1fr] gap-3 sm:gap-4 lg:order-2">
          <RevealFrame
            delay={d(0.1)}
            state={state}
            className="relative row-span-2 h-[300px] overflow-hidden rounded-2xl bg-sand sm:h-[460px] lg:h-[500px]"
            overlay={
              featured && (
                <motion.div
                  initial="hidden"
                  animate={state}
                  variants={rise(d(1), 10)}
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
              )
            }
          >
            <ProductImage
              src={portrait(IMG.blushMaxiDress)}
              alt="Woman wearing a flowing blush floral maxi dress"
              fill
              priority
              sizes="(min-width: 1024px) 30vw, 55vw"
              className="object-[center_30%]"
            />
          </RevealFrame>

          <RevealFrame
            delay={d(0.2)}
            state={state}
            className="relative h-[144px] overflow-hidden rounded-2xl bg-sand sm:h-[222px] lg:h-[242px]"
          >
            <ProductImage
              src={portrait(IMG.greenKurti)}
              alt="Woman in a green printed ethnic kurti"
              fill
              priority
              sizes="(min-width: 1024px) 22vw, 42vw"
              className="object-[center_25%]"
            />
          </RevealFrame>

          <RevealFrame
            delay={d(0.3)}
            state={state}
            className="relative h-[144px] overflow-hidden rounded-2xl bg-ink sm:h-[222px] lg:h-[242px]"
            overlay={
              <Link href="/new-arrivals" className="group absolute inset-0 flex flex-col justify-end p-4 text-white">
                <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                <span className="relative text-xs font-semibold tracking-widest uppercase">Just in</span>
                <span className="relative flex items-center gap-1 font-display text-xl font-semibold sm:text-2xl">
                  New Arrivals <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            }
          >
            <ProductImage
              src={portrait(IMG.redSilkSaree)}
              alt="Woman in a red silk saree — new arrivals"
              fill
              sizes="(min-width: 1024px) 22vw, 42vw"
              className="object-[center_25%] opacity-70"
            />
          </RevealFrame>
        </div>
      </div>
    </section>
  );
}
