"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { stockState } from "@/lib/admin/metrics";
import { cn } from "@/lib/utils";
import { useAdminStore } from "@/store/admin-store";
import { ADMIN_NAV, isAdminPathActive } from "./admin-nav";

function useNavCounts() {
  const newOrders = useAdminStore((s) => s.orders.filter((o) => o.status === "Order Placed").length);
  const lowStock = useAdminStore((s) => s.products.filter((p) => p.status !== "archived" && stockState(p) !== "in").length);
  return { newOrders, lowStock };
}

/** Brand block + grouped navigation, on the royal maroon used by the storefront footer. */
export function AdminSidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const counts = useNavCounts();

  return (
    <div className="flex h-full flex-col bg-royal text-white">
      <div className="relative flex items-center gap-3 px-5 pt-5 pb-5">
        <Logo onDark href="/admin" className="[&_img]:h-10 [&_img]:w-10" />
        <div className="leading-none">
          <p className="font-display text-[22px] font-bold tracking-[0.03em] text-white">
            M<span className="text-gold-gradient">&amp;</span>M
          </p>
          <p className="mt-1 text-[9px] font-bold tracking-[0.34em] text-gold-light/80">ADMIN STUDIO</p>
        </div>
        <div className="gold-rule absolute inset-x-5 bottom-0 opacity-40" aria-hidden />
      </div>

      <nav aria-label="Admin" className="no-scrollbar flex-1 overflow-y-auto px-3 py-4">
        {ADMIN_NAV.map((group) => (
          <div key={group.label} className="mb-5 last:mb-0">
            <p className="mb-1.5 px-3 text-[10.5px] font-semibold tracking-[0.2em] text-gold-light/55 uppercase">{group.label}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isAdminPathActive(pathname, item.href);
                const count = item.badge ? counts[item.badge] : 0;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                        active ? "bg-white/[0.09] text-white" : "text-white/65 hover:bg-white/[0.05] hover:text-white",
                      )}
                    >
                      {active && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-gradient-to-b from-gold-light via-gold to-gold-dark" aria-hidden />}
                      <item.icon size={18} className={cn("shrink-0", active ? "text-gold-light" : "text-white/55 group-hover:text-white/80")} aria-hidden />
                      <span className="flex-1">{item.label}</span>
                      {count > 0 && (
                        <span
                          className={cn(
                            "min-w-5 rounded-full px-1.5 py-px text-center text-[11px] font-bold tabular-nums",
                            item.badge === "newOrders" ? "bg-accent text-white" : "bg-gold text-royal",
                          )}
                        >
                          {count}
                          <span className="sr-only">{item.badge === "newOrders" ? " new orders" : " products low or out of stock"}</span>
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 p-3">
        <Link
          href="/"
          target="_blank"
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/65 transition-colors hover:bg-white/[0.05] hover:text-white"
        >
          <ExternalLink size={17} aria-hidden />
          View storefront
          <span className="sr-only">(opens in a new tab)</span>
        </Link>
        <p className="px-3 pt-2 text-[11px] leading-4 text-white/40">Demo mode · changes stay in this browser tab</p>
      </div>
    </div>
  );
}
