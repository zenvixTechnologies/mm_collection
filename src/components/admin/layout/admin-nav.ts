import {
  BadgePercent,
  Boxes,
  CreditCard,
  FolderTree,
  LayoutDashboard,
  LayoutTemplate,
  Settings,
  ShoppingBag,
  Shirt,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface AdminNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Which live count to show beside the item. */
  badge?: "newOrders" | "lowStock";
}

export interface AdminNavGroup {
  label: string;
  items: AdminNavItem[];
}

export const ADMIN_NAV: AdminNavGroup[] = [
  { label: "Overview", items: [{ href: "/admin", label: "Dashboard", icon: LayoutDashboard }] },
  {
    label: "Catalogue",
    items: [
      { href: "/admin/products", label: "Products", icon: Shirt },
      { href: "/admin/categories", label: "Categories", icon: FolderTree },
      { href: "/admin/inventory", label: "Inventory", icon: Boxes, badge: "lowStock" },
    ],
  },
  {
    label: "Sales",
    items: [
      { href: "/admin/orders", label: "Orders", icon: ShoppingBag, badge: "newOrders" },
      { href: "/admin/customers", label: "Customers", icon: Users },
      { href: "/admin/payments", label: "Payments", icon: CreditCard },
    ],
  },
  {
    label: "Marketing",
    items: [
      { href: "/admin/coupons", label: "Coupons & Offers", icon: BadgePercent },
      { href: "/admin/homepage", label: "Homepage", icon: LayoutTemplate },
    ],
  },
  {
    label: "Store",
    items: [
      { href: "/admin/shipping", label: "Shipping", icon: Truck },
      { href: "/admin/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function isAdminPathActive(pathname: string, href: string) {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}
