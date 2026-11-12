"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Heart, Menu, Search, ShoppingBag, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getAudience } from "@/data/audiences";
import { getCategoriesByAudience } from "@/data/categories";
import { useHydrated } from "@/hooks/use-hydrated";
import { cn } from "@/lib/utils";
import { useActiveAudience } from "@/store/audience-store";
import { useCartStore } from "@/store/cart-store";
import { useUIStore } from "@/store/ui-store";
import { useWishlistStore } from "@/store/wishlist-store";
import { ProductImage } from "@/components/ui/ProductImage";
import { Logo } from "./Logo";
import { AudienceSwitcher } from "./AudienceSwitcher";
import { NAV_LINKS, isActivePath, navHref } from "./navigation";

function CountBadge({ count, label }: { count: number; label: string }) {
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.span
          key={count}
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.4, opacity: 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 22 }}
          className="absolute top-1 right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10.5px] font-bold text-white"
        >
          {count > 99 ? "99+" : count}
          <span className="sr-only"> {label}</span>
        </motion.span>
      )}
    </AnimatePresence>
  );
}

export function Header() {
  const pathname = usePathname();
  const hydrated = useHydrated();
  const cartCount = useCartStore((s) => s.items.reduce((n, i) => n + i.quantity, 0));
  const wishCount = useWishlistStore((s) => s.ids.length);
  const { setCartOpen, setSearchOpen, setMenuOpen } = useUIStore();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setCatMenuOpen] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const audience = useActiveAudience();
  const audienceInfo = getAudience(audience);
  const menuCategories = getCategoriesByAudience(audience);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => setCatMenuOpen(false), [pathname]);

  const openMenu = () => {
    window.clearTimeout(closeTimer.current);
    setCatMenuOpen(true);
  };
  const scheduleClose = () => {
    closeTimer.current = window.setTimeout(() => setCatMenuOpen(false), 120);
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b bg-white/95 backdrop-blur-md transition-shadow duration-300",
        scrolled ? "border-line shadow-[0_2px_18px_rgb(34_34_34/0.06)]" : "border-transparent",
      )}
    >
      <div className="gold-rule pointer-events-none absolute inset-x-0 bottom-0 opacity-70" aria-hidden />
      <div className="container-page relative flex h-16 items-center gap-2 lg:h-20">
        {/* Mobile: menu */}
        <button type="button" className="icon-btn -ml-2 lg:hidden" aria-label="Open menu" onClick={() => setMenuOpen(true)}>
          <Menu size={22} />
        </button>

        <Logo withWordmark priority className="absolute left-1/2 -translate-x-1/2 lg:static lg:translate-x-0" />

        {/* Desktop nav */}
        <nav aria-label="Main" className="mx-auto hidden items-center gap-3 lg:flex xl:gap-5">
          <AudienceSwitcher variant="header" />
          <span className="h-6 w-px bg-line" aria-hidden />
          <ul className="flex items-center gap-1">
            {NAV_LINKS.filter((link) => link.desktop).map((link) => {
              const active = isActivePath(pathname, link.href);
              const base = cn(
                "relative flex h-10 items-center gap-1 rounded-full px-4 text-[14.5px] font-medium transition-colors",
                active ? "text-ink" : "text-muted hover:text-ink",
              );
              const underline = active && (
                <motion.span layoutId="nav-underline" className="absolute inset-x-4 -bottom-0.5 h-[2px] rounded-full bg-gradient-to-r from-gold-dark via-gold to-gold-dark" />
              );
              if ("hasMenu" in link) {
                return (
                  <li key={link.href} className="relative" onMouseEnter={openMenu} onMouseLeave={scheduleClose}>
                    <div className="flex items-center">
                      <Link href={link.href} className={cn(base, "pr-1.5")} aria-current={active ? "page" : undefined}>
                        {link.label}
                        {underline}
                      </Link>
                      <button
                        type="button"
                        className="-ml-1 flex h-8 w-7 items-center justify-center rounded-full text-muted hover:text-ink"
                        aria-expanded={menuOpen}
                        aria-controls="category-menu"
                        aria-label="Show categories"
                        onClick={() => setCatMenuOpen((o) => !o)}
                      >
                        <ChevronDown size={15} className={cn("transition-transform", menuOpen && "rotate-180")} />
                      </button>
                    </div>
                    <AnimatePresence>
                      {menuOpen && (
                        <motion.div
                          id="category-menu"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 6 }}
                          transition={{ duration: 0.18 }}
                          className="absolute top-full left-1/2 z-50 w-[720px] -translate-x-1/2 pt-3"
                          onKeyDown={(e) => e.key === "Escape" && setCatMenuOpen(false)}
                        >
                          <div className="grid grid-cols-[1fr_200px] gap-6 rounded-2xl border border-line bg-white p-6 shadow-[var(--shadow-pop)]">
                            <ul className="grid grid-cols-3 content-start gap-x-4 gap-y-1">
                              <li className="col-span-3 mb-1 px-3 text-xs font-semibold tracking-[0.16em] text-muted uppercase">
                                {audienceInfo.possessive} categories
                              </li>
                              {menuCategories.map((c) => (
                                <li key={c.id}>
                                  <Link
                                    href={`/categories/${c.slug}`}
                                    className="block rounded-lg px-3 py-2 text-sm text-ink transition-colors hover:bg-sand"
                                  >
                                    {c.name}
                                  </Link>
                                </li>
                              ))}
                              <li className="col-span-3 mt-2 border-t border-line pt-3">
                                <Link href={audienceInfo.href} className="px-3 text-sm font-semibold text-accent hover:underline">
                                  Shop the {audienceInfo.possessive} collection →
                                </Link>
                                <Link href="/shop" className="px-3 text-sm text-muted hover:text-ink hover:underline">
                                  Shop all products
                                </Link>
                              </li>
                            </ul>
                            <Link href={`/new-arrivals?for=${audience}`} className="group relative overflow-hidden rounded-xl">
                              <div className="relative aspect-[4/5]">
                                <ProductImage
                                  src={menuCategories[0].image}
                                  alt={`${audienceInfo.possessive} new arrivals at M&M COLLECTIONS`}
                                  fill
                                  sizes="200px"
                                  className="transition-transform duration-500 group-hover:scale-105"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                                <p className="absolute bottom-3 left-3 text-sm font-semibold text-white">New Arrivals →</p>
                              </div>
                            </Link>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </li>
                );
              }
              return (
                <li key={link.href}>
                  <Link href={navHref(link, audience)} className={base} aria-current={active ? "page" : undefined}>
                    {link.label}
                    {underline}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Actions */}
        <div className="ml-auto flex items-center lg:ml-0">
          <button type="button" className="icon-btn" aria-label="Search products" onClick={() => setSearchOpen(true)}>
            <Search size={20} />
          </button>
          <Link href="/account" className="icon-btn hidden sm:inline-flex" aria-label="My account">
            <User size={20} />
          </Link>
          <Link href="/wishlist" className="icon-btn hidden sm:inline-flex" aria-label="Wishlist">
            <Heart size={20} />
            {hydrated && <CountBadge count={wishCount} label="items in wishlist" />}
          </Link>
          <button type="button" className="icon-btn -mr-2" aria-label="Open shopping bag" onClick={() => setCartOpen(true)}>
            <ShoppingBag size={20} />
            {hydrated && <CountBadge count={cartCount} label="items in bag" />}
          </button>
        </div>
      </div>
    </header>
  );
}
