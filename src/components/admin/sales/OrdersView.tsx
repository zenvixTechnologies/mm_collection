"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronRight, Download, ShoppingBag } from "lucide-react";
import { useMemo, useState } from "react";
import type { AdminOrder, AdminOrderStatus } from "@/types/admin";
import { MOCK_NOW } from "@/data/admin/mock-utils";
import { formatDate, formatPrice } from "@/lib/utils";
import { useAdminStore } from "@/store/admin-store";
import { toast } from "@/store/ui-store";
import { OrderStatusBadge, PaymentStatusBadge } from "../ui/Badge";
import { downloadCsv } from "../ui/csv";
import { DataTable, TableEmpty, type Column } from "../ui/DataTable";
import { PageHeader } from "../ui/PageHeader";
import { FilterSelect, SearchInput, Tabs, Toolbar } from "../ui/Toolbar";
import { ADMIN_ORDER_STATUSES, PAYMENT_METHOD_LABEL, nextStatuses } from "./sales-helpers";

type StatusTab = "all" | AdminOrderStatus;
type RangeFilter = "all" | "7" | "30" | "90";

export function OrdersView() {
  const params = useSearchParams();
  const orders = useAdminStore((s) => s.orders);
  const updateOrderStatus = useAdminStore((s) => s.updateOrderStatus);
  const initialTab = params.get("status");
  const [tab, setTab] = useState<StatusTab>(ADMIN_ORDER_STATUSES.includes(initialTab as AdminOrderStatus) ? (initialTab as AdminOrderStatus) : "all");
  const [q, setQ] = useState(params.get("q") ?? "");
  const [method, setMethod] = useState<"all" | "upi" | "card" | "netbanking">("all");
  const [range, setRange] = useState<RangeFilter>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState<AdminOrderStatus>("Confirmed");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const from = range === "all" ? 0 : MOCK_NOW.getTime() - Number(range) * 86_400_000;
    return orders.filter(
      (o) =>
        (tab === "all" || o.status === tab) &&
        (method === "all" || o.paymentMethod === method) &&
        new Date(o.createdAt).getTime() > from &&
        (!term ||
          o.id.toLowerCase().includes(term) ||
          o.customer.fullName.toLowerCase().includes(term) ||
          o.customer.email.toLowerCase().includes(term) ||
          o.customer.mobile.includes(term)),
    );
  }, [orders, tab, method, range, q]);

  const count = (s: AdminOrderStatus) => orders.filter((o) => o.status === s).length;

  const columns: Column<AdminOrder>[] = [
    {
      id: "id",
      header: "Order",
      sortValue: (o) => o.id,
      cell: (o) => (
        <div className="whitespace-nowrap">
          <Link href={`/admin/orders/${o.id}`} className="font-semibold hover:text-accent hover:underline">
            {o.id}
          </Link>
          <p className="text-xs text-muted">
            {o.items.reduce((n, i) => n + i.quantity, 0)} item{o.items.reduce((n, i) => n + i.quantity, 0) > 1 ? "s" : ""}
          </p>
        </div>
      ),
    },
    {
      id: "date",
      header: "Placed",
      sortValue: (o) => o.createdAt,
      hideBelow: "md",
      cell: (o) => <span className="whitespace-nowrap text-muted">{formatDate(o.createdAt, true)}</span>,
    },
    {
      id: "customer",
      header: "Customer",
      sortValue: (o) => o.customer.fullName,
      cell: (o) => (
        <div className="min-w-[140px]">
          <Link href={`/admin/customers/${o.customerId}`} className="font-medium hover:underline">
            {o.customer.fullName}
          </Link>
          <p className="text-xs text-muted">
            {o.address.city}, {o.address.state}
          </p>
        </div>
      ),
    },
    {
      id: "payment",
      header: "Payment",
      hideBelow: "lg",
      sortValue: (o) => o.paymentStatus,
      cell: (o) => (
        <div className="flex flex-col items-start gap-1">
          <PaymentStatusBadge status={o.paymentStatus} />
          <span className="text-xs text-muted">{PAYMENT_METHOD_LABEL[o.paymentMethod]}</span>
        </div>
      ),
    },
    { id: "status", header: "Status", sortValue: (o) => ADMIN_ORDER_STATUSES.indexOf(o.status), cell: (o) => <OrderStatusBadge status={o.status} /> },
    {
      id: "total",
      header: "Total",
      align: "right",
      sortValue: (o) => o.total,
      cell: (o) => <span className="font-semibold whitespace-nowrap tabular-nums">{formatPrice(o.total)}</span>,
    },
    {
      id: "go",
      header: <span className="sr-only">Open</span>,
      align: "right",
      className: "w-10",
      cell: (o) => (
        <Link href={`/admin/orders/${o.id}`} className="icon-btn h-9 w-9 text-muted" aria-label={`Open order ${o.id}`}>
          <ChevronRight size={17} />
        </Link>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Orders" }]}
        title="Orders"
        description="Confirm, pack and ship orders, and keep customers updated with tracking."
        actions={
          <button
            type="button"
            className="btn-outline btn-sm"
            onClick={() => {
              downloadCsv(
                "mm-orders.csv",
                ["Order", "Placed", "Customer", "Mobile", "City", "Items", "Total", "Payment", "Status"],
                filtered.map((o) => [o.id, o.createdAt, o.customer.fullName, o.customer.mobile, o.address.city, o.items.length, o.total, o.paymentStatus, o.status]),
              );
              toast.success(`Exported ${filtered.length} orders`);
            }}
          >
            <Download size={15} aria-hidden /> Export CSV
          </button>
        }
      />

      <div className="card overflow-hidden">
        <div className="px-4 pt-3">
          <Tabs<StatusTab>
            label="Order status"
            value={tab}
            onChange={(t) => {
              setTab(t);
              setSelected([]);
            }}
            items={[{ value: "all", label: "All", count: orders.length }, ...ADMIN_ORDER_STATUSES.map((s) => ({ value: s, label: s, count: count(s) }))]}
          />
        </div>
        <Toolbar className="p-4">
          <SearchInput value={q} onChange={setQ} placeholder="Order ID, name, email or mobile" label="Search orders" className="sm:max-w-xs sm:flex-1" />
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <FilterSelect
              label="Payment method"
              value={method}
              onChange={setMethod}
              options={[
                { value: "all", label: "All methods" },
                { value: "upi", label: "UPI" },
                { value: "card", label: "Card" },
                { value: "netbanking", label: "Net banking" },
              ]}
            />
            <FilterSelect
              label="Date range"
              value={range}
              onChange={setRange}
              options={[
                { value: "all", label: "All time" },
                { value: "7", label: "Last 7 days" },
                { value: "30", label: "Last 30 days" },
                { value: "90", label: "Last 90 days" },
              ]}
            />
          </div>
          <p className="text-[13px] text-muted sm:ml-auto">
            {filtered.length} order{filtered.length === 1 ? "" : "s"} · {formatPrice(filtered.filter((o) => o.status !== "Cancelled").reduce((s, o) => s + o.total, 0))}
          </p>
        </Toolbar>
        <DataTable
          caption="Orders"
          rows={filtered}
          columns={columns}
          getRowId={(o) => o.id}
          resetKey={`${tab}|${q}|${method}|${range}`}
          initialSort={{ id: "date", dir: "desc" }}
          selectable
          selected={selected}
          onSelectedChange={setSelected}
          bulkActions={(ids) => (
            <>
              <label htmlFor="bulk-status" className="text-[13px] text-muted">
                Move to
              </label>
              <select id="bulk-status" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value as AdminOrderStatus)} className="field-input field-sm h-8 w-auto bg-white">
                {(["Confirmed", "Processing", "Shipped", "Out for Delivery", "Delivered"] as const).map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <button
                type="button"
                className="btn-primary btn-sm min-h-8"
                onClick={() => {
                  const movable = ids.filter((id) => {
                    const o = orders.find((x) => x.id === id);
                    return o && nextStatuses(o.status).includes(bulkStatus);
                  });
                  movable.forEach((id) => updateOrderStatus(id, bulkStatus));
                  const skipped = ids.length - movable.length;
                  if (movable.length) toast.success(`${movable.length} order${movable.length > 1 ? "s" : ""} moved to ${bulkStatus}`);
                  if (skipped) toast.info(`${skipped} skipped — they're already at or past that status`);
                  setSelected([]);
                }}
              >
                Apply
              </button>
            </>
          )}
          empty={<TableEmpty icon={<ShoppingBag size={24} />} title="No orders found" description="Try another status, date range or search." />}
        />
      </div>
    </>
  );
}
