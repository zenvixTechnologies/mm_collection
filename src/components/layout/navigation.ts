import type { Audience } from "@/types";

export const NAV_LINKS = [
  { href: "/", label: "Home", desktop: false },
  { href: "/shop", label: "Shop", desktop: false },
  { href: "/categories", label: "Categories", hasMenu: true, desktop: true },
  { href: "/new-arrivals", label: "New Arrivals", desktop: true, perAudience: true },
  { href: "/best-sellers", label: "Best Sellers", desktop: true, perAudience: true },
] as const;

/** New Arrivals / Best Sellers open on the audience being browsed. */
export function navHref(link: (typeof NAV_LINKS)[number], audience: Audience) {
  return "perAudience" in link ? `${link.href}?for=${audience}` : link.href;
}

export function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/categories") return pathname.startsWith("/categories");
  if (href === "/shop") return pathname === "/shop" || pathname.startsWith("/product/");
  return pathname === href || pathname.startsWith(`${href}/`);
}
