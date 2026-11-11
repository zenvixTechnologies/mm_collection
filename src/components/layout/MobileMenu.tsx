"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Heart, Package, Phone, Truck, User } from "lucide-react";
import { useEffect, useState } from "react";
import { categories } from "@/data/categories";
import { useHydrated } from "@/hooks/use-hydrated";
import { cn, SITE } from "@/lib/utils";
import { useCurrentUser } from "@/store/auth-store";
import { useUIStore } from "@/store/ui-store";
import { useWishlistStore } from "@/store/wishlist-store";
import { Dialog } from "@/components/ui/Dialog";
import { NAV_LINKS, isActivePath } from "./navigation";

export function MobileMenu() {
  const open = useUIStore((s) => s.menuOpen);
  const setOpen = useUIStore((s) => s.setMenuOpen);
  const pathname = usePathname();
  const hydrated = useHydrated();
  const user = useCurrentUser();
  const wishCount = useWishlistStore((s) => s.ids.length);
  const [catsOpen, setCatsOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname, setOpen]);

  return (
    <Dialog open={open} onClose={() => setOpen(false)} title="Menu" variant="left">
      <nav aria-label="Mobile" className="flex h-full flex-col">
        <ul className="px-3 py-2">
          {NAV_LINKS.map((link) => {
            const active = isActivePath(pathname, link.href);
            if ("hasMenu" in link) {
              return (
                <li key={link.href}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center justify-between rounded-xl px-3 py-3.5 text-left text-[16px] font-medium",
                      active ? "text-accent" : "text-ink",
                    )}
                    aria-expanded={catsOpen}
                    onClick={() => setCatsOpen((o) => !o)}
                  >
                    {link.label}
                    <ChevronDown size={18} className={cn("transition-transform", catsOpen && "rotate-180")} />
                  </button>
                  <AnimatePresence initial={false}>
                    {catsOpen && (
                      <motion.ul
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.22 }}
                        className="overflow-hidden pl-3"
                      >
                        <li>
                          <Link href="/categories" className="block rounded-lg px-3 py-2.5 text-[15px] font-semibold text-accent">
                            All categories
                          </Link>
                        </li>
                        {categories.map((c) => (
                          <li key={c.id}>
                            <Link
                              href={`/categories/${c.slug}`}
                              className={cn(
                                "block rounded-lg px-3 py-2.5 text-[15px]",
                                pathname === `/categories/${c.slug}` ? "bg-sand font-medium text-ink" : "text-muted",
                              )}
                            >
                              {c.name}
                            </Link>
                          </li>
                        ))}
                      </motion.ul>
                    )}
                  </AnimatePresence>
                </li>
              );
            }
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "block rounded-xl px-3 py-3.5 text-[16px] font-medium",
                    active ? "bg-accent-soft text-accent" : "text-ink",
                  )}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="mx-6 border-t border-line" />

        <ul className="space-y-0.5 px-3 py-3 text-[15px]">
          <li>
            <Link href={user ? "/account" : "/login"} className="flex items-center gap-3 rounded-xl px-3 py-3 text-ink">
              <User size={19} className="text-muted" />
              {hydrated && user ? `Hi, ${user.fullName.split(" ")[0]}` : "Login / Register"}
            </Link>
          </li>
          <li>
            <Link href="/wishlist" className="flex items-center gap-3 rounded-xl px-3 py-3 text-ink">
              <Heart size={19} className="text-muted" />
              Wishlist
              {hydrated && wishCount > 0 && (
                <span className="ml-auto rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">{wishCount}</span>
              )}
            </Link>
          </li>
          <li>
            <Link href="/account/orders" className="flex items-center gap-3 rounded-xl px-3 py-3 text-ink">
              <Package size={19} className="text-muted" />
              My Orders
            </Link>
          </li>
          <li>
            <Link href="/track-order" className="flex items-center gap-3 rounded-xl px-3 py-3 text-ink">
              <Truck size={19} className="text-muted" />
              Track Order
            </Link>
          </li>
        </ul>

        <div className="mt-auto bg-canvas px-6 py-5 text-sm text-muted">
          <p className="font-semibold text-ink">Need help choosing a size?</p>
          <a href={`tel:${SITE.phone.replace(/\s/g, "")}`} className="mt-1 flex items-center gap-2 text-ink">
            <Phone size={15} /> {SITE.phone}
          </a>
          <p className="mt-1 text-xs">{SITE.hours}</p>
        </div>
      </nav>
    </Dialog>
  );
}
