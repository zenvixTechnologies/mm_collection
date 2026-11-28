"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronRight, Download, Loader2, ShoppingBag } from "lucide-react";
import { useState } from "react";
import type { AdminOrder, AdminOrderStatus, AdminPage } from "@/types/admin";
import { useAdminQuery, withQuery } from "@/hooks/use-admin-query";
import { useDebounced } from "@/hooks/use-debounced";
import { adminApi, errorMessage } from "@/lib/admin-api";
import { formatDate, formatPrice } from "@/lib/utils";
import { useAdminSession } from "@/store/admin-store";
import { toast } from "@/store/ui-store";
import { OrderStatusBadge, PaymentStatusBadge } from "../ui/Badge";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { downloadCsv } from "../ui/csv";
import { DataTable, TableEmpty, type Column, type SortState } from "../ui/DataTable";
import { PageHeader } from "../ui/PageHeader";
import { LoadError, TableSkeleton } from "../ui/QueryState";
import { FilterSelect, SearchInput, Tabs, Toolbar } from "../ui/Toolbar";
import { ADMIN_ORDER_STATUSES, PAYMENT_METHOD_LABEL } from "./sales-helpers";

type StatusTab = "all" | AdminOrderStatus;
type RangeFilter = "all" | "7" | "30" | "90";
type OrderPage = AdminPage<AdminOrder> & { counts: Partial<Record<StatusTab, number>>; revenue: number };

const PAGE_SIZE = 20;
const BULK_STATUSES = ["Confirmed", "Processing", "Packed", "Shipped", "Out for Delivery", "Delivered"] as const;
/** Bulk moves customers see as shipping milestones are confirmed first. */
const CONFIRM_BULK: readonly string[] = ["Shipped", "Out for Delivery", "Delivered"];

const daysAgo = (days: string) => (days === "all" ? "" : new Date(Date.now() - Number(days) * 86_400_000).toISOString().slice(0, 10));

export function OrdersView() {
  const params = useSearchParams();
  const canWrite = useAdminSession((s) => s.can("orders:write"));
  const initialTab = params.get("status");
  const [tab, setTab] = useState<StatusTab>(ADMIN_ORDER_STATUSES.includes(initialTab as AdminOrderStatus) ? (initialTab as AdminOrderStatus) : "all");
  const [q, setQ] = useState(params.get("q") ?? "");
  const [method, setMethod] = useState<"all" | "upi" | "card" | "netbanking">("all");
  const [range, setRange] = useState<RangeFilter>("all");
  const [sort, setSort] = useState<SortState>({ id: "date", dir: "desc" });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState<(typeof BULK_STATUSES)[number]>("Confirmed");
  const [busy, setBusy] = useState<"bulk" | "export" | null>(null);
  const [confirmBulk, setConfirmBulk] = useState<string[] | null>(null);

  const term = useDebounced(q.trim());
  const filters = {
    q: term,
    status: tab === "all" ? undefined : tab,
    method: method === "all" ? undefined : method,
    from: daysAgo(range),
    sort: sort.id === "total" ? "total" : "created",
    dir: sort.dir,
  };
  const filterKey = JSON.stringify(filters);
  const [lastKey, setLastKey] = useState(filterKey);
  if (filterKey !== lastKey) {
    setLastKey(filterKey);
    setPage(1);
    setSelected([]);
  }
  const { data, status, error, refreshing, reload } = useAdminQuery<OrderPage>(withQuery("/orders", { ...filters, page, limit: PAGE_SIZE }));
  const rows = data?.items ?? [];
  const count = (s: StatusTab) => data?.counts?.[s] ?? 0;

  const exportCsv = async () => {
    setBusy("export");
    try {
      const all: AdminOrder[] = [];
      for (let p = 1; p <= 100; p++) {
        const res = await adminApi<OrderPage>(withQuery("/orders", { ...filters, page: p, limit: 100 }));
        all.push(...res.data.items);
        if (p >= res.data.totalPages) break;
      }
      downloadCsv(
        "mm-orders.csv",
        ["Order", "Placed", "Customer", "Mobile", "City", "Items", "Total", "Payment", "Status"],
        all.map((o) => [o.id, o.createdAt, o.customer.fullName, o.customer.mobile, o.address.city, o.items.length, o.total, o.paymentStatus, o.status]),
      );
      toast.success(`Exported ${all.length} orders`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const applyBulk = async (ids: string[]) => {
    setBusy("bulk");
    try {
      const { data: r } = await adminApi<{ updated: string[]; skipped: { id: string; reason: string }[] }>("/orders/bulk-status", {
        method: "POST",
        body: { ids, status: bulkStatus },
      });
      if (r.updated.length) toast.success(`${r.updated.length} order${r.updated.length > 1 ? "s" : ""} moved to ${bulkStatus}`);
      if (r.skipped.length) toast.info(`${r.skipped.length} skipped — ${r.skipped[0].reason}`);
      setSelected([]);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const columns: Column<AdminOrder>[] = [
    {
      id: "id",
      header: "Order",
      cell: (o) => (
        <div className="whitespace-nowrap">
          <Link href={`/mm-hub/orders/${o.id}`} className="font-semibold hover:text-accent hover:underline">
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
      cell: (o) => (
        <div className="min-w-[140px]">
          {o.customerId ? (
            <Link href={`/mm-hub/customers/${o.customerId}`} className="font-medium hover:underline">
              {o.customer.fullName}
            </Link>
          ) : (
            <span className="font-medium">
              {o.customer.fullName} <span className="text-xs font-normal text-muted">(guest)</span>
            </span>
          )}
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
      cell: (o) => (
        <div className="flex flex-col items-start gap-1">
          <PaymentStatusBadge status={o.paymentStatus} />
          <span className="text-xs text-muted">{PAYMENT_METHOD_LABEL[o.paymentMethod]}</span>
        </div>
      ),
    },
    { id: "status", header: "Status", cell: (o) => <OrderStatusBadge status={o.status} /> },
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
        <Link href={`/mm-hub/orders/${o.id}`} className="icon-btn h-9 w-9 text-muted" aria-label={`Open order ${o.id}`}>
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
        description="Confirm, pack and ship orders, and keep customers updated on order status."
        actions={
          <button type="button" className="btn-outline btn-sm" disabled={busy === "export" || !data?.total} onClick={() => void exportCsv()}>
            {busy === "export" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Download size={15} aria-hidden />} Export CSV
          </button>
        }
      />

      <div className="card overflow-hidden">
        <div className="px-4 pt-3">
          <Tabs<StatusTab>
            label="Order status"
            value={tab}
            onChange={setTab}
            items={[{ value: "all", label: "All", count: count("all") }, ...ADMIN_ORDER_STATUSES.map((s) => ({ value: s, label: s, count: count(s) }))]}
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
            {data?.total ?? 0} order{data?.total === 1 ? "" : "s"} · {formatPrice(data?.revenue ?? 0)} paid
          </p>
        </Toolbar>
        {status === "loading" ? (
          <TableSkeleton />
        ) : status === "error" ? (
          <LoadError title="Couldn't load orders" message={error} onRetry={reload} />
        ) : (
          <DataTable
            caption="Orders"
            rows={rows}
            columns={columns}
            getRowId={(o) => o.id}
            sort={sort}
            onSortChange={setSort}
            server={{ page, totalPages: data?.totalPages ?? 1, total: data?.total ?? 0, limit: PAGE_SIZE, onPageChange: setPage, loading: refreshing }}
            selectable={canWrite}
            selected={selected}
            onSelectedChange={setSelected}
            bulkActions={(ids) => (
              <>
                <label htmlFor="bulk-status" className="text-[13px] text-muted">
                  Move to
                </label>
                <select
                  id="bulk-status"
                  value={bulkStatus}
                  onChange={(e) => setBulkStatus(e.target.value as (typeof BULK_STATUSES)[number])}
                  className="field-input field-sm h-8 w-auto bg-white"
                >
                  {BULK_STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-primary btn-sm min-h-8"
                  disabled={busy === "bulk"}
                  onClick={() => {
                    if (CONFIRM_BULK.includes(bulkStatus)) setConfirmBulk(ids);
                    else void applyBulk(ids);
                  }}
                >
                  {busy === "bulk" && <Loader2 size={14} className="animate-spin" aria-hidden />} Apply
                </button>
              </>
            )}
            empty={<TableEmpty icon={<ShoppingBag size={24} />} title="No orders found" description="Try another status, date range or search." />}
          />
        )}
      </div>

      <ConfirmDialog
        open={confirmBulk !== null}
        onClose={() => setConfirmBulk(null)}
        title={`Move ${confirmBulk?.length ?? 0} order${confirmBulk?.length === 1 ? "" : "s"} to ${bulkStatus}?`}
        description="Customers will see this on their order tracking page. Status moves can't be undone. Orders that can't make this move are skipped."
        confirmLabel={`Move to ${bulkStatus}`}
        destructive={false}
        onConfirm={() => {
          if (confirmBulk) void applyBulk(confirmBulk);
        }}
      />
    </>
  );
}
