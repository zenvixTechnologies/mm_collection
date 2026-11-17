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
  { label: "Overview", items: [{ href: "/mm-hub", label: "Dashboard", icon: LayoutDashboard }] },
  {
    label: "Catalogue",
    items: [
      { href: "/mm-hub/products", label: "Products", icon: Shirt },
      { href: "/mm-hub/categories", label: "Categories", icon: FolderTree },
      { href: "/mm-hub/inventory", label: "Inventory", icon: Boxes, badge: "lowStock" },
    ],
  },
  {
    label: "Sales",
    items: [
      { href: "/mm-hub/orders", label: "Orders", icon: ShoppingBag, badge: "newOrders" },
      { href: "/mm-hub/customers", label: "Customers", icon: Users },
      { href: "/mm-hub/payments", label: "Payments", icon: CreditCard },
    ],
  },
  {
    label: "Marketing",
    items: [
      { href: "/mm-hub/coupons", label: "Coupons & Offers", icon: BadgePercent },
      { href: "/mm-hub/homepage", label: "Homepage", icon: LayoutTemplate },
    ],
  },
  {
    label: "Store",
    items: [
      { href: "/mm-hub/shipping", label: "Shipping", icon: Truck },
      { href: "/mm-hub/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function isAdminPathActive(pathname: string, href: string) {
  if (href === "/mm-hub") return pathname === "/mm-hub";
  return pathname === href || pathname.startsWith(`${href}/`);
}
