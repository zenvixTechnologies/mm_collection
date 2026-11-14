"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, IndianRupee, Plus, ReceiptText, ShoppingBag, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { ORDER_STATUSES } from "@/types";
import type { Audience } from "@/types";
import { AUDIENCES } from "@/data/audiences";
import { MOCK_NOW } from "@/data/admin/mock-utils";
import { isRevenueOrder, periodSummary, salesSeries, stockState, topProducts } from "@/lib/admin/metrics";
import { formatDate, formatPrice } from "@/lib/utils";
import { useAdminSession, useAdminStore } from "@/store/admin-store";
import { ProductImage } from "@/components/ui/ProductImage";
import { OrderStatusBadge, StockBadge } from "../ui/Badge";
import { BarList, TrendChart, type ChartPoint } from "../ui/Charts";
import { formatCompactPrice, formatNumber, timeAgo } from "../ui/format";
import { PageHeader } from "../ui/PageHeader";
import { Panel, StatCard } from "../ui/Panel";
import { Segmented } from "../ui/Toolbar";

type Range = "7" | "30" | "90";
const RANGES: { value: Range; label: string }[] = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function DashboardView() {
  const user = useAdminSession((s) => s.user);
  const orders = useAdminStore((s) => s.orders);
  const customers = useAdminStore((s) => s.customers);
  const products = useAdminStore((s) => s.products);
  const activity = useAdminStore((s) => s.activity);
  const [range, setRange] = useState<Range>("30");
  const [metric, setMetric] = useState<"revenue" | "orders">("revenue");
  const days = Number(range);

  const summary = useMemo(() => periodSummary(orders, customers, days, MOCK_NOW), [orders, customers, days]);
  const series = useMemo(() => salesSeries(orders, days, MOCK_NOW), [orders, days]);
  const chartData: ChartPoint[] = series.map((d) => {
    const date = new Date(`${d.date}T12:00:00+05:30`);
    return {
      key: d.date,
      label: date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }),
      tick: date.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
      value: metric === "revenue" ? d.revenue : d.orders,
    };
  });

  const inRange = useMemo(() => {
    const from = MOCK_NOW.getTime() - days * 86_400_000;
    return orders.filter((o) => new Date(o.createdAt).getTime() > from);
  }, [orders, days]);

  const pipeline = ORDER_STATUSES.slice(0, 5).map((s) => ({
    key: s,
    label: s,
    value: orders.filter((o) => o.status === s).length,
  }));

  const byAudience = AUDIENCES.map((a) => {
    let revenue = 0;
    for (const o of inRange) {
      if (!isRevenueOrder(o)) continue;
      for (const it of o.items) {
        const aud: Audience = it.audience ?? products.find((p) => p.id === it.productId)?.audienceCategory ?? "women";
        if (aud === a.id) revenue += it.price * it.quantity;
      }
    }
    return { key: a.id, label: a.possessive, value: revenue };
  });
  const audienceTotal = byAudience.reduce((s, a) => s + a.value, 0) || 1;

  const top = topProducts(inRange, 5);
  const alerts = products
    .filter((p) => p.status === "active" && stockState(p) !== "in")
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 5);
  const recent = orders.slice(0, 6);

  return (
    <>
      <PageHeader
        eyebrow={`${greeting()}, ${user?.name.split(" ")[0] ?? "there"}`}
        title="Store overview"
        description={`Figures for the last ${days} days, compared with the ${days} days before. Demo data as of ${formatDate(MOCK_NOW.toISOString())}.`}
        actions={
          <>
            <Segmented label="Date range" items={RANGES} value={range} onChange={setRange} />
            <Link href="/admin/products?new=1" className="btn-primary btn-sm">
              <Plus size={16} aria-hidden /> Add product
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Revenue" value={formatCompactPrice(summary.revenue)} icon={<IndianRupee size={18} />} change={summary.change.revenue} hint={formatPrice(summary.revenue)} />
        <StatCard label="Orders" value={formatNumber(summary.orders)} icon={<ShoppingBag size={18} />} change={summary.change.orders} hint="excl. cancelled" tone="gold" />
        <StatCard
          label="Average order value"
          value={formatPrice(summary.averageOrderValue)}
          icon={<ReceiptText size={18} />}
          change={summary.change.averageOrderValue}
          tone="royal"
        />
        <StatCard label="New customers" value={formatNumber(summary.newCustomers)} icon={<UserPlus size={18} />} change={summary.change.newCustomers} hint="sign-ups" tone="success" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title={metric === "revenue" ? "Revenue" : "Orders"}
          description={`Daily ${metric === "revenue" ? "revenue (₹, excl. cancelled orders)" : "orders placed"} · last ${days} days`}
          action={
            <Segmented
              label="Chart metric"
              items={[
                { value: "revenue", label: "Revenue" },
                { value: "orders", label: "Orders" },
              ]}
              value={metric}
              onChange={setMetric}
            />
          }
        >
          <TrendChart
            key={`${metric}-${range}`}
            data={chartData}
            kind={metric === "revenue" ? "area" : "bar"}
            height={300}
            label={`Daily ${metric}, last ${days} days`}
            valueName={metric === "revenue" ? "revenue" : "orders"}
            format={(v) => (metric === "revenue" ? formatPrice(v) : formatNumber(v))}
            axisFormat={(v) => (metric === "revenue" ? formatCompactPrice(v) : formatNumber(v))}
          />
        </Panel>

        <Panel
          title="Order pipeline"
          description="Open orders by status, all time"
          action={
            <Link href="/admin/orders" className="text-[13px] font-semibold text-accent hover:underline">
              Manage
            </Link>
          }
        >
          <BarList label="Open orders by status" items={pipeline.map((p) => ({ ...p, display: formatNumber(p.value) }))} />
          <div className="mt-6 rounded-xl bg-canvas p-4">
            <p className="text-[13px] text-muted">Needs your attention</p>
            <p className="mt-1 font-display text-3xl font-semibold">
              {pipeline[0].value + pipeline[1].value}
              <span className="ml-2 font-sans text-sm font-normal text-muted">orders to confirm or pack</span>
            </p>
          </div>
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="Recent orders"
          flush
          action={
            <Link href="/admin/orders" className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:underline">
              View all <ArrowRight size={14} aria-hidden />
            </Link>
          }
        >
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Six most recent orders</caption>
              <thead>
                <tr className="border-b border-line bg-canvas/80 text-left text-[11.5px] tracking-[0.08em] text-muted uppercase">
                  <th scope="col" className="px-5 py-3 font-semibold">Order</th>
                  <th scope="col" className="hidden px-4 py-3 font-semibold sm:table-cell">Customer</th>
                  <th scope="col" className="hidden px-4 py-3 font-semibold md:table-cell">Placed</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {recent.map((o) => (
                  <tr key={o.id} className="hover:bg-canvas/70">
                    <td className="px-5 py-3">
                      <Link href={`/admin/orders/${o.id}`} className="font-semibold hover:text-accent hover:underline">
                        {o.id}
                      </Link>
                      <p className="text-xs text-muted sm:hidden">{o.customer.fullName}</p>
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">{o.customer.fullName}</td>
                    <td className="hidden px-4 py-3 text-muted md:table-cell">{timeAgo(o.createdAt)}</td>
                    <td className="px-4 py-3">
                      <OrderStatusBadge status={o.status} />
                    </td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums">{formatPrice(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Sales by audience" description={`Share of item revenue · last ${days} days`}>
          <BarList
            label="Revenue by audience"
            tone="gold"
            items={byAudience.map((a) => ({
              ...a,
              display: formatCompactPrice(a.value),
              hint: `${Math.round((a.value / audienceTotal) * 100)}%`,
            }))}
          />
          <p className="mt-5 text-xs leading-5 text-muted">Women remains the core of the business; Men and Kids are growing lines.</p>
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <Panel title="Top products" description={`By revenue · last ${days} days`} flush>
          <ul className="divide-y divide-line">
            {top.map((p, i) => (
              <li key={p.productId} className="flex items-center gap-3 px-5 py-3">
                <span className="w-4 text-xs font-semibold text-subtle tabular-nums">{i + 1}</span>
                <span className="relative h-12 w-10 shrink-0 overflow-hidden rounded-lg bg-sand">
                  <ProductImage src={p.image} alt="" fill sizes="40px" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  <span className="text-xs text-muted">{p.units} sold</span>
                </span>
                <span className="text-sm font-semibold tabular-nums">{formatCompactPrice(p.revenue)}</span>
              </li>
            ))}
            {!top.length && <li className="px-5 py-8 text-center text-sm text-muted">No sales in this period.</li>}
          </ul>
        </Panel>

        <Panel
          title={
            <span className="inline-flex items-center gap-2">
              <AlertTriangle size={16} className="text-warning" aria-hidden /> Stock alerts
            </span>
          }
          description="Active products at or below their low-stock level"
          flush
          action={
            <Link href="/admin/inventory?filter=low" className="text-[13px] font-semibold text-accent hover:underline">
              Inventory
            </Link>
          }
        >
          <ul className="divide-y divide-line">
            {alerts.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                <span className="relative h-12 w-10 shrink-0 overflow-hidden rounded-lg bg-sand">
                  <ProductImage src={p.images[0]} alt="" fill sizes="40px" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  <span className="text-xs text-muted">{p.sku}</span>
                </span>
                <StockBadge state={stockState(p)} stock={p.stock} />
              </li>
            ))}
            {!alerts.length && <li className="px-5 py-8 text-center text-sm text-muted">All products are well stocked.</li>}
          </ul>
        </Panel>

        <Panel title="Recent activity" className="lg:col-span-2 xl:col-span-1">
          <ol className="relative space-y-4 before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px before:bg-line">
            {activity.slice(0, 7).map((a) => (
              <li key={a.id} className="relative pl-6 text-sm">
                <span className="absolute top-1.5 left-0 h-[11px] w-[11px] rotate-45 bg-gradient-to-br from-gold-light to-gold-dark" aria-hidden />
                <p className="leading-5">
                  <span className="font-semibold">{a.actor}</span> <span className="text-muted">{a.action}</span>{" "}
                  {a.href ? (
                    <Link href={a.href} className="font-medium text-accent hover:underline">
                      {a.target}
                    </Link>
                  ) : (
                    <span className="font-medium">{a.target}</span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-subtle">{timeAgo(a.at)}</p>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </>
  );
}
