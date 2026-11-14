import { describe, expect, it } from "vitest";
import type { AdminCustomer, AdminOrder } from "@/types/admin";
import { customersWithStats, periodSummary, salesSeries, stockState, topProducts } from "./metrics";

const END = new Date("2026-11-14T11:30:00+05:30");

function order(id: string, createdAt: string, total: number, extra: Partial<AdminOrder> = {}): AdminOrder {
  return {
    id,
    createdAt,
    items: [{ productId: "p1", slug: "p1", name: "Kurti", image: "", price: total, size: "M", color: null, quantity: 1 }],
    customer: { fullName: "A", mobile: "9", email: "a@x.in" },
    address: { house: "", street: "", city: "", district: "", state: "", pincode: "" },
    paymentMethod: "upi",
    couponCode: null,
    subtotal: total,
    discount: 0,
    shipping: null,
    total,
    status: "Delivered",
    history: {},
    customerId: "c1",
    paymentStatus: "captured",
    notes: [],
    ...extra,
  };
}

const customer = (id: string, joinedAt: string): AdminCustomer => ({
  id,
  fullName: id,
  email: `${id}@x.in`,
  mobile: "9",
  joinedAt,
  status: "active",
  addresses: [],
  primaryAudience: "women",
  marketingOptIn: false,
  notes: "",
});

describe("salesSeries", () => {
  it("buckets orders by IST day and skips cancelled ones", () => {
    const series = salesSeries(
      [
        order("a", "2026-11-14T09:00:00+05:30", 1000),
        // 23:30 UTC on the 13th is already the 14th in India
        order("b", "2026-11-13T23:30:00Z", 500),
        order("c", "2026-11-13T10:00:00+05:30", 700),
        order("d", "2026-11-14T08:00:00+05:30", 900, { status: "Cancelled" }),
      ],
      3,
      END,
    );
    expect(series.map((d) => d.date)).toEqual(["2026-11-12", "2026-11-13", "2026-11-14"]);
    expect(series[2]).toMatchObject({ revenue: 1500, orders: 2 });
    expect(series[1]).toMatchObject({ revenue: 700, orders: 1 });
  });
});

describe("periodSummary", () => {
  it("compares with the previous period", () => {
    const s = periodSummary(
      [order("a", "2026-11-13T10:00:00+05:30", 2000), order("b", "2026-11-05T10:00:00+05:30", 1000)],
      [customer("x", "2026-11-12T10:00:00+05:30")],
      7,
      END,
    );
    expect(s.revenue).toBe(2000);
    expect(s.orders).toBe(1);
    expect(s.change.revenue).toBe(100);
    expect(s.newCustomers).toBe(1);
    expect(s.change.newCustomers).toBeNull();
  });
});

describe("customersWithStats", () => {
  it("totals spend without cancelled orders but still counts them", () => {
    const [c] = customersWithStats(
      [customer("c1", "2026-01-01T00:00:00Z")],
      [order("a", "2026-11-01T10:00:00Z", 800), order("b", "2026-11-03T10:00:00Z", 400, { status: "Cancelled" })],
    );
    expect(c).toMatchObject({ orderCount: 2, totalSpent: 800, lastOrderAt: "2026-11-03T10:00:00Z" });
  });
});

describe("stockState", () => {
  it("classifies stock against the threshold", () => {
    expect(stockState({ stock: 0, lowStockThreshold: 10 })).toBe("out");
    expect(stockState({ stock: 10, lowStockThreshold: 10 })).toBe("low");
    expect(stockState({ stock: 11, lowStockThreshold: 10 })).toBe("in");
  });
});

describe("topProducts", () => {
  it("ranks by revenue", () => {
    const rows = topProducts([order("a", "2026-11-01T10:00:00Z", 800), order("b", "2026-11-02T10:00:00Z", 400)]);
    expect(rows[0]).toMatchObject({ productId: "p1", units: 2, revenue: 1200 });
  });
});
