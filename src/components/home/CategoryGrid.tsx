import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { categories } from "@/data/categories";
import { IMG, portrait } from "@/data/images";
import { getProductsByCategory, getNewArrivals, products } from "@/data/products";
import { cn } from "@/lib/utils";
import { ProductImage } from "@/components/ui/ProductImage";
import { Reveal } from "@/components/ui/Reveal";

interface Tile {
  href: string;
  name: string;
  image: string;
  count: number;
}

export function CategoryGrid({ variant = "home" }: { variant?: "home" | "page" }) {
  const tiles: Tile[] = [
    { href: "/shop", name: "All Products", image: portrait(IMG.rackTops), count: products.length },
    ...categories.map((c) => ({
      href: `/categories/${c.slug}`,
      name: c.name,
      image: c.image,
      count: getProductsByCategory(c.id).length,
    })),
    { href: "/new-arrivals", name: "New Arrivals", image: portrait(IMG.ruffleBlouse), count: getNewArrivals().length },
  ];

  if (variant === "home") {
    // Circular portrait tiles: a light, recognisable "shop by category" row.
    // Horizontal scroller on mobile, 7-up grid from tablet.
    return (
      <ul className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-7 sm:gap-x-4 sm:gap-y-8 sm:overflow-visible sm:px-0">
        {tiles.map((t, i) => (
          <li key={t.href} className="w-[84px] shrink-0 snap-start sm:w-auto">
            <Reveal delay={Math.min(i % 7, 6) * 0.04}>
              <Link href={t.href} className="group flex flex-col items-center text-center">
                <span className="block w-full max-w-[136px] rounded-full p-[3px] ring-1 ring-gold-light transition-all duration-300 group-hover:ring-2 group-hover:ring-gold">
                  <span className="relative block aspect-square overflow-hidden rounded-full bg-sand">
                    <ProductImage
                      src={t.image}
                      alt=""
                      fill
                      sizes="(min-width: 640px) 136px, 84px"
                      className="object-[center_22%] transition-transform duration-700 ease-out group-hover:scale-[1.08]"
                    />
                  </span>
                </span>
                <span className="mt-3 text-[13px] leading-tight font-medium text-ink transition-colors group-hover:text-accent sm:text-sm">
                  {t.name}
                </span>
              </Link>
            </Reveal>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
      {tiles.map((t, i) => (
        <li key={t.href}>
          <Reveal delay={Math.min(i % 4, 3) * 0.05}>
            <Link href={t.href} className="group relative block overflow-hidden rounded-[var(--radius-card)] bg-sand">
              <div className="relative aspect-[4/5]">
                <ProductImage
                  src={t.image}
                  alt={t.name}
                  fill
                  priority={i < 4}
                  sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
                  className="transition-transform duration-700 ease-out group-hover:scale-[1.05]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/5 to-transparent" />
              </div>
              <div className={cn("absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-4 text-white")}>
                <div>
                  <p className="font-display text-xl font-semibold sm:text-2xl">{t.name}</p>
                  <p className="text-xs text-white/80">{t.count} styles</p>
                </div>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-ink transition-transform group-hover:rotate-45">
                  <ArrowUpRight size={17} />
                </span>
              </div>
            </Link>
          </Reveal>
        </li>
      ))}
    </ul>
  );
}
