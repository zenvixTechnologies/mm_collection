"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Heart, LogOut, MapPin, Package, Truck, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore, useCurrentUser } from "@/store/auth-store";
import { toast } from "@/store/ui-store";

const LINKS = [
  { href: "/account", label: "Profile", icon: User },
  { href: "/account/orders", label: "My Orders", icon: Package },
  { href: "/account#addresses", label: "Saved Addresses", icon: MapPin },
  { href: "/wishlist", label: "Wishlist", icon: Heart },
  { href: "/track-order", label: "Track Order", icon: Truck },
];

export function AccountNav() {
  const pathname = usePathname();
  const router = useRouter();
  const user = useCurrentUser();
  const logout = useAuthStore((s) => s.logout);

  return (
    <nav aria-label="Account" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0">
      {LINKS.map((l) => {
        const active = l.href === pathname || (l.href === "/account/orders" && pathname.startsWith("/account/orders"));
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium transition-colors lg:rounded-xl",
              active ? "bg-ink text-white" : "bg-canvas text-ink hover:bg-sand lg:bg-transparent",
            )}
          >
            <l.icon size={17} />
            {l.label}
          </Link>
        );
      })}
      {user && (
        <button
          type="button"
          onClick={() => {
            logout();
            toast.info("You've been logged out");
            router.push("/");
          }}
          className="flex shrink-0 items-center gap-3 rounded-full bg-canvas px-4 py-2.5 text-sm font-medium text-danger transition-colors hover:bg-danger-soft lg:mt-2 lg:rounded-xl lg:bg-transparent"
        >
          <LogOut size={17} /> Logout
        </button>
      )}
    </nav>
  );
}

export function AccountShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="container-page pt-6 lg:pt-8">
      <h1 className="font-display text-4xl font-semibold sm:text-5xl">{title}</h1>
      <div className="mt-6 grid gap-6 lg:mt-8 lg:grid-cols-[230px_1fr] lg:gap-10">
        <aside className="min-w-0">
          <AccountNav />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
