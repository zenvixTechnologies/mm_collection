import type { ActivityItem, AdminNotification, StockAdjustment } from "@/types/admin";
import { mockProducts } from "./catalog";
import { mockOrders, mockPayments } from "./orders";
import { daysAgo, hoursAfter } from "./mock-utils";

const latest = mockOrders.slice(0, 3);
const lowStock = mockProducts.filter((p) => p.stock > 0 && p.stock <= p.lowStockThreshold).slice(0, 2);
const outOfStock = mockProducts.find((p) => p.stock === 0);
const failed = mockPayments.find((p) => p.status === "failed");

export const mockNotifications: AdminNotification[] = [
  ...latest.map(
    (o, i): AdminNotification => ({
      id: `n-order-${o.id}`,
      kind: "order",
      title: `New order ${o.id}`,
      body: `${o.customer.fullName} placed an order for ${o.items.length} item${o.items.length > 1 ? "s" : ""}.`,
      href: `/admin/orders/${o.id}`,
      at: o.createdAt,
      read: i > 0,
    }),
  ),
  ...(outOfStock
    ? [
        {
          id: `n-oos-${outOfStock.id}`,
          kind: "stock" as const,
          title: "Out of stock",
          body: `${outOfStock.name} has sold out.`,
          href: "/admin/inventory?filter=out",
          at: daysAgo(0, 9, 10),
          read: false,
        },
      ]
    : []),
  ...lowStock.map(
    (p): AdminNotification => ({
      id: `n-low-${p.id}`,
      kind: "stock",
      title: "Low stock",
      body: `${p.name} has only ${p.stock} left.`,
      href: "/admin/inventory?filter=low",
      at: daysAgo(1, 18, 40),
      read: true,
    }),
  ),
  ...(failed
    ? [
        {
          id: `n-pay-${failed.id}`,
          kind: "payment" as const,
          title: "Payment failed",
          body: `${failed.customerName}: ${failed.errorReason ?? "payment failed"}.`,
          href: "/admin/payments?status=failed",
          at: failed.createdAt,
          read: true,
        },
      ]
    : []),
].sort((a, b) => b.at.localeCompare(a.at));

export const mockActivity: ActivityItem[] = [
  ...latest.map((o) => ({
    id: `a-${o.id}`,
    actor: o.customer.fullName,
    action: "placed order",
    target: o.id,
    href: `/admin/orders/${o.id}`,
    at: o.createdAt,
  })),
  ...mockOrders
    .filter((o) => o.status === "Shipped")
    .slice(0, 2)
    .map((o) => ({
      id: `a-ship-${o.id}`,
      actor: "Maria Mathew",
      action: "marked as shipped",
      target: o.id,
      href: `/admin/orders/${o.id}`,
      at: o.history.Shipped ?? o.createdAt,
    })),
  {
    id: "a-coupon",
    actor: "Maria Mathew",
    action: "created coupon",
    target: "FESTIVE20",
    href: "/admin/coupons",
    at: daysAgo(2, 15, 5),
  },
  {
    id: "a-banner",
    actor: "Maria Mathew",
    action: "updated homepage banner",
    target: "Festive Edit",
    href: "/admin/homepage",
    at: daysAgo(3, 12, 30),
  },
].sort((a, b) => b.at.localeCompare(a.at));

export const mockStockAdjustments: StockAdjustment[] = mockProducts.slice(0, 8).map((p, i) => {
  const reasons: StockAdjustment["reason"][] = ["Restock", "Sale", "Return", "Restock", "Damaged", "Correction", "Restock", "Return"];
  const change = { Restock: 12, Sale: -2, Return: 1, Damaged: -1, Correction: -3 }[reasons[i]];
  return {
    id: `adj-${i}`,
    productId: p.id,
    productName: p.name,
    sku: p.sku,
    change,
    reason: reasons[i],
    stockAfter: p.stock,
    by: i % 3 === 0 ? "Maria Mathew" : "Store staff",
    at: hoursAfter(daysAgo(i, 10), i * 3),
  };
});
