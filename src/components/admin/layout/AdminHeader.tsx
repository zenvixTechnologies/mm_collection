"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, ChevronDown, CreditCard, ExternalLink, LogOut, Menu, Package, Search, Settings, ShoppingBag, User, Users } from "lucide-react";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useAdminSession, useAdminStore } from "@/store/admin-store";
import { toast } from "@/store/ui-store";
import { timeAgo } from "../ui/format";
import { useDismiss } from "./use-dismiss";

const popMotion = {
  initial: { opacity: 0, y: 6, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 4, scale: 0.98 },
  transition: { duration: 0.16 },
};

/* ---------- Global search: products, orders, customers ---------- */

function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listId = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  const products = useAdminStore((s) => s.products);
  const orders = useAdminStore((s) => s.orders);
  const customers = useAdminStore((s) => s.customers);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (term.length < 2) return [];
    const has = (...v: string[]) => v.some((x) => x.toLowerCase().includes(term));
    return [
      ...orders
        .filter((o) => has(o.id, o.customer.fullName))
        .slice(0, 4)
        .map((o) => ({ id: `o-${o.id}`, icon: ShoppingBag, title: o.id, sub: `${o.customer.fullName} · ${o.status}`, href: `/admin/orders/${o.id}` })),
      ...products
        .filter((p) => has(p.name, p.sku))
        .slice(0, 4)
        .map((p) => ({ id: `p-${p.id}`, icon: Package, title: p.name, sub: p.sku, href: `/admin/products?q=${encodeURIComponent(p.sku)}` })),
      ...customers
        .filter((c) => has(c.fullName, c.email, c.mobile))
        .slice(0, 4)
        .map((c) => ({ id: `c-${c.id}`, icon: Users, title: c.fullName, sub: c.email, href: `/admin/customers/${c.id}` })),
    ];
  }, [q, orders, products, customers]);

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };

  return (
    <div ref={ref} className="relative w-full max-w-md">
      <Search size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" aria-hidden />
      <input
        type="search"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="Search orders, products and customers"
        placeholder="Search orders, products, customers…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setCursor(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!results.length) return;
          if (e.key === "ArrowDown") setCursor((c) => (c + 1) % results.length);
          else if (e.key === "ArrowUp") setCursor((c) => (c - 1 + results.length) % results.length);
          else if (e.key === "Enter") go(results[cursor].href);
          else return;
          e.preventDefault();
        }}
        className="h-10 w-full rounded-full border border-transparent bg-canvas pr-4 pl-10 text-sm text-ink placeholder:text-subtle focus:border-line focus:bg-white focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-ink/10 [&::-webkit-search-cancel-button]:hidden"
      />
      <AnimatePresence>
        {open && q.trim().length >= 2 && (
          <motion.div {...popMotion} className="absolute top-full right-0 left-0 z-50 mt-2 overflow-hidden rounded-2xl border border-line bg-white shadow-[var(--shadow-pop)]">
            {results.length ? (
              <ul id={listId} role="listbox" className="max-h-[60vh] overflow-y-auto py-1.5">
                {results.map((r, i) => (
                  <li key={r.id} role="option" aria-selected={i === cursor}>
                    <button
                      type="button"
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => go(r.href)}
                      className={cn("flex w-full items-center gap-3 px-4 py-2 text-left", i === cursor && "bg-canvas")}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sand text-accent">
                        <r.icon size={15} aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{r.title}</span>
                        <span className="block truncate text-xs text-muted">{r.sub}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-5 text-center text-sm text-muted">No matches for “{q.trim()}”.</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------- Notifications ---------- */

const KIND_ICON = { order: ShoppingBag, stock: Package, payment: CreditCard, customer: Users };

function Notifications() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  const items = useAdminStore((s) => s.notifications);
  const markRead = useAdminStore((s) => s.markNotificationRead);
  const markAll = useAdminStore((s) => s.markAllNotificationsRead);
  const unread = items.filter((n) => !n.read).length;

  return (
    <div ref={ref} className="relative">
      <button type="button" className="icon-btn" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Bell size={20} />
        {unread > 0 && (
          <span className="absolute top-1.5 right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10.5px] font-bold text-white" aria-hidden>
            {unread}
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            {...popMotion}
            className="fixed inset-x-3 top-[4.5rem] z-50 overflow-hidden rounded-2xl border border-line bg-white shadow-[var(--shadow-pop)] sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-[380px]"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="text-sm font-semibold">Notifications</p>
              {unread > 0 && (
                <button type="button" onClick={markAll} className="text-xs font-semibold text-accent hover:underline">
                  Mark all as read
                </button>
              )}
            </div>
            <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
              {items.map((n) => {
                const Icon = KIND_ICON[n.kind];
                return (
                  <li key={n.id}>
                    <Link
                      href={n.href}
                      onClick={() => {
                        markRead(n.id);
                        setOpen(false);
                      }}
                      className={cn("flex gap-3 px-4 py-3 transition-colors hover:bg-canvas", !n.read && "bg-gold-soft/40")}
                    >
                      <span
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                          n.kind === "stock" ? "bg-gold-soft text-gold-dark" : n.kind === "payment" ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent",
                        )}
                        aria-hidden
                      >
                        <Icon size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm font-semibold">
                          {n.title}
                          {!n.read && <span className="h-2 w-2 rounded-full bg-accent" aria-label="unread" />}
                        </span>
                        <span className="mt-0.5 block text-[13px] leading-5 text-muted">{n.body}</span>
                        <span className="mt-1 block text-[11px] text-subtle">{timeAgo(n.at)}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
              {!items.length && <li className="px-4 py-8 text-center text-sm text-muted">You&apos;re all caught up.</li>}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------- Profile menu ---------- */

function ProfileMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  const user = useAdminSession((s) => s.user);
  const logout = useAdminSession((s) => s.logout);
  if (!user) return null;

  const item = "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink transition-colors hover:bg-sand";
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2.5 rounded-full py-1 pr-2 pl-1 transition-colors hover:bg-sand"
      >
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-bold text-royal"
          style={{ backgroundImage: "linear-gradient(135deg, #e8cd7e 0%, #c9a54c 48%, #b08a32 100%)" }}
          aria-hidden
        >
          {user.avatarInitials}
        </span>
        <span className="hidden text-left leading-tight md:block">
          <span className="block text-sm font-semibold">{user.name}</span>
          <span className="block text-[11px] text-muted">{user.role}</span>
        </span>
        <ChevronDown size={15} className={cn("hidden text-muted transition-transform md:block", open && "rotate-180")} aria-hidden />
        <span className="sr-only md:hidden">Account menu</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div {...popMotion} role="menu" className="absolute top-full right-0 z-50 mt-2 w-60 rounded-2xl border border-line bg-white p-1.5 shadow-[var(--shadow-pop)]">
            <div className="border-b border-line px-3 pt-2 pb-3">
              <p className="text-sm font-semibold">{user.name}</p>
              <p className="truncate text-xs text-muted">{user.email}</p>
            </div>
            <div className="py-1.5">
              <Link role="menuitem" href="/admin/settings?tab=account" onClick={close} className={item}>
                <User size={16} className="text-muted" aria-hidden /> My profile
              </Link>
              <Link role="menuitem" href="/admin/settings" onClick={close} className={item}>
                <Settings size={16} className="text-muted" aria-hidden /> Store settings
              </Link>
              <Link role="menuitem" href="/" target="_blank" onClick={close} className={item}>
                <ExternalLink size={16} className="text-muted" aria-hidden /> View storefront
              </Link>
            </div>
            <div className="border-t border-line pt-1.5">
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  logout();
                  toast.info("Signed out of the admin panel");
                  router.replace("/admin/login");
                }}
                className={cn(item, "text-danger hover:bg-danger-soft")}
              >
                <LogOut size={16} aria-hidden /> Sign out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function AdminHeader({ onOpenMenu }: { onOpenMenu: () => void }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-white/95 backdrop-blur-md print:hidden">
      <div className="flex h-16 items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:px-8">
        <button type="button" className="icon-btn -ml-2 lg:hidden" aria-label="Open navigation" onClick={onOpenMenu}>
          <Menu size={22} />
        </button>
        <div className="min-w-0 flex-1">
          <GlobalSearch />
        </div>
        <Link href="/" target="_blank" className="btn-ghost btn-sm hidden gap-1.5 xl:inline-flex">
          <ExternalLink size={15} aria-hidden /> View store
        </Link>
        <Notifications />
        <ProfileMenu />
      </div>
      <div className="gold-rule pointer-events-none absolute inset-x-0 bottom-0 opacity-60" aria-hidden />
    </header>
  );
}
