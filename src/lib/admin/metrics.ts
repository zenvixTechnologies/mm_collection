import type { AdminCustomer, AdminOrder, AdminProduct, CustomerWithStats, DailySales } from "@/types/admin";
import { istDateKey } from "@/data/admin/mock-utils";

/** Orders that count towards revenue (cancelled orders are refunded). */
export function isRevenueOrder(o: AdminOrder) {
  return o.status !== "Cancelled";
}

/** One bucket per day for the `days` days ending on `end` (inclusive), oldest first. */
export function salesSeries(orders: AdminOrder[], days: number, end: Date): DailySales[] {
  const buckets = new Map<string, DailySales>();
  for (let i = days - 1; i >= 0; i--) {
    const key = istDateKey(new Date(end.getTime() - i * 86_400_000));
    buckets.set(key, { date: key, revenue: 0, orders: 0 });
  }
  for (const o of orders) {
    if (!isRevenueOrder(o)) continue;
    const b = buckets.get(istDateKey(o.createdAt));
    if (b) {
      b.revenue += o.total;
      b.orders += 1;
    }
  }
  return [...buckets.values()];
}

export interface PeriodSummary {
  revenue: number;
  orders: number;
  averageOrderValue: number;
  newCustomers: number;
  /** Percentage change versus the previous period of the same length; null when there's nothing to compare. */
  change: { revenue: number | null; orders: number | null; averageOrderValue: number | null; newCustomers: number | null };
}

function pctChange(current: number, previous: number) {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export function periodSummary(orders: AdminOrder[], customers: AdminCustomer[], days: number, end: Date): PeriodSummary {
  const endT = end.getTime();
  const startT = endT - days * 86_400_000;
  const prevStartT = startT - days * 86_400_000;
  const within = (iso: string, from: number, to: number) => {
    const t = new Date(iso).getTime();
    return t > from && t <= to;
  };
  const sum = (from: number, to: number) => {
    const list = orders.filter((o) => isRevenueOrder(o) && within(o.createdAt, from, to));
    const revenue = list.reduce((s, o) => s + o.total, 0);
    return { revenue, orders: list.length, aov: list.length ? revenue / list.length : 0 };
  };
  const cur = sum(startT, endT);
  const prev = sum(prevStartT, startT);
  const newCur = customers.filter((c) => within(c.joinedAt, startT, endT)).length;
  const newPrev = customers.filter((c) => within(c.joinedAt, prevStartT, startT)).length;
  return {
    revenue: cur.revenue,
    orders: cur.orders,
    averageOrderValue: cur.aov,
    newCustomers: newCur,
    change: {
      revenue: pctChange(cur.revenue, prev.revenue),
      orders: pctChange(cur.orders, prev.orders),
      averageOrderValue: pctChange(cur.aov, prev.aov),
      newCustomers: pctChange(newCur, newPrev),
    },
  };
}

export function customersWithStats(customers: AdminCustomer[], orders: AdminOrder[]): CustomerWithStats[] {
  const stats = new Map<string, { count: number; spent: number; last: string | null }>();
  for (const o of orders) {
    const s = stats.get(o.customerId) ?? { count: 0, spent: 0, last: null };
    s.count += 1;
    if (isRevenueOrder(o)) s.spent += o.total;
    if (!s.last || o.createdAt > s.last) s.last = o.createdAt;
    stats.set(o.customerId, s);
  }
  return customers.map((c) => {
    const s = stats.get(c.id);
    return { ...c, orderCount: s?.count ?? 0, totalSpent: s?.spent ?? 0, lastOrderAt: s?.last ?? null };
  });
}

export type StockState = "in" | "low" | "out";

export function stockState(p: Pick<AdminProduct, "stock" | "lowStockThreshold">): StockState {
  if (p.stock <= 0) return "out";
  if (p.stock <= p.lowStockThreshold) return "low";
  return "in";
}

/** Units sold per product from the given orders, highest first. */
export function topProducts(orders: AdminOrder[], limit = 5) {
  const map = new Map<string, { productId: string; name: string; image: string; units: number; revenue: number }>();
  for (const o of orders) {
    if (!isRevenueOrder(o)) continue;
    for (const it of o.items) {
      const row = map.get(it.productId) ?? { productId: it.productId, name: it.name, image: it.image, units: 0, revenue: 0 };
      row.units += it.quantity;
      row.revenue += it.price * it.quantity;
      map.set(it.productId, row);
    }
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, limit);
}
