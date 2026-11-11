export const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/shop", label: "Shop" },
  { href: "/categories", label: "Categories", hasMenu: true },
  { href: "/new-arrivals", label: "New Arrivals" },
  { href: "/best-sellers", label: "Best Sellers" },
] as const;

export function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/categories") return pathname.startsWith("/categories");
  if (href === "/shop") return pathname === "/shop" || pathname.startsWith("/product/");
  return pathname === href || pathname.startsWith(`${href}/`);
}
