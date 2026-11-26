"use client";

import Link from "next/link";
import { Download, Loader2, Users } from "lucide-react";
import { useState } from "react";
import type { AdminPage, CustomerWithStats } from "@/types/admin";
import { useAdminQuery, withQuery } from "@/hooks/use-admin-query";
import { useDebounced } from "@/hooks/use-debounced";
import { adminApi, errorMessage } from "@/lib/admin-api";
import { formatDate, formatPrice } from "@/lib/utils";
import { toast } from "@/store/ui-store";
import { Badge } from "../ui/Badge";
import { downloadCsv } from "../ui/csv";
import { DataTable, TableEmpty, type Column, type SortState } from "../ui/DataTable";
import { initials } from "../ui/format";
import { PageHeader } from "../ui/PageHeader";
import { LoadError, TableSkeleton } from "../ui/QueryState";
import { DateRangeFilter, SearchInput, Tabs, Toolbar } from "../ui/Toolbar";

type Segment = "all" | "new" | "repeat" | "vip" | "blocked";

/** Spend at which a customer counts as high value (the server uses the same threshold). */
export const VIP_SPEND = 10_000;

/** Table column → server sort field. */
const SORT_PARAM: Record<string, string> = { name: "name", orders: "orders", spent: "spent", last: "last" };

export function Avatar({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  return (
    <span
      className={
        size === "lg"
          ? "flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-royal font-display text-2xl font-semibold text-gold-light"
          : "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sand text-xs font-bold text-accent"
      }
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

type CustomerPage = AdminPage<CustomerWithStats> & { segments: Partial<Record<Segment, number>> };

const PAGE_SIZE = 20;

export function CustomersView() {
  const [segment, setSegment] = useState<Segment>("all");
  const [q, setQ] = useState("");
  const [joined, setJoined] = useState({ from: "", to: "" });
  const [sort, setSort] = useState<SortState>({ id: "spent", dir: "desc" });
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const term = useDebounced(q.trim());
  const filters = { q: term, segment, from: joined.from, to: joined.to, sort: SORT_PARAM[sort.id] ?? "joined", dir: sort.dir };
  const filterKey = JSON.stringify(filters);
  const [lastKey, setLastKey] = useState(filterKey);
  if (filterKey !== lastKey) {
    setLastKey(filterKey);
    setPage(1);
  }
  const { data, status, error, refreshing, reload } = useAdminQuery<CustomerPage>(withQuery("/customers", { ...filters, page, limit: PAGE_SIZE }));
  const rows = data?.items ?? [];
  const segCount = (s: Segment) => data?.segments?.[s] ?? 0;

  /** Every customer matching the current filters, page by page (for the CSV export). */
  const exportCsv = async () => {
    setExporting(true);
    try {
      const all: CustomerWithStats[] = [];
      for (let p = 1; p <= 100; p++) {
        const res = await adminApi<CustomerPage>(withQuery("/customers", { ...filters, page: p, limit: 100 }));
        all.push(...res.data.items);
        if (p >= res.data.totalPages) break;
      }
      downloadCsv(
        "mm-customers.csv",
        ["Name", "Email", "Mobile", "City", "Orders", "Total spent", "Joined", "Marketing opt-in", "Status"],
        all.map((c) => [c.fullName, c.email, c.mobile, c.addresses[0]?.city, c.orderCount, c.totalSpent, c.joinedAt, c.marketingOptIn ? "yes" : "no", c.status]),
      );
      toast.success(`Exported ${all.length} customers`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<CustomerWithStats>[] = [
    {
      id: "name",
      header: "Customer",
      sortValue: (c) => c.fullName,
      cell: (c) => (
        <div className="flex min-w-[200px] items-center gap-3">
          <Avatar name={c.fullName} />
          <div className="min-w-0">
            <Link href={`/mm-hub/customers/${c.id}`} className="font-semibold hover:text-accent hover:underline">
              {c.fullName}
            </Link>
            <p className="truncate text-xs text-muted">{c.email}</p>
          </div>
        </div>
      ),
    },
    { id: "mobile", header: "Mobile", hideBelow: "lg", cell: (c) => <span className="whitespace-nowrap tabular-nums">+91 {c.mobile}</span> },
    { id: "city", header: "Location", hideBelow: "xl", cell: (c) => <span className="whitespace-nowrap">{c.addresses[0] ? `${c.addresses[0].city}, ${c.addresses[0].state}` : "—"}</span> },
    { id: "orders", header: "Orders", align: "right", sortValue: (c) => c.orderCount, cell: (c) => <span className="tabular-nums">{c.orderCount}</span> },
    {
      id: "spent",
      header: "Total spent",
      align: "right",
      sortValue: (c) => c.totalSpent,
      cell: (c) => (
        <span className="font-semibold whitespace-nowrap tabular-nums">
          {formatPrice(c.totalSpent)}
          {c.totalSpent >= VIP_SPEND && <span className="ml-1.5 text-gold-dark" title="High-value customer">◆</span>}
        </span>
      ),
    },
    {
      id: "last",
      header: "Last order",
      hideBelow: "md",
      sortValue: (c) => c.lastOrderAt ?? "",
      cell: (c) => <span className="whitespace-nowrap text-muted">{c.lastOrderAt ? formatDate(c.lastOrderAt) : "Never"}</span>,
    },
    {
      id: "status",
      header: "Status",
      hideBelow: "sm",
      cell: (c) => (c.status === "active" ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Blocked</Badge>),
    },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Customers" }]}
        title="Customers"
        description="Everyone who has an account or has ordered. Open a profile to see their orders and addresses."
        actions={
          <button type="button" className="btn-outline btn-sm" disabled={exporting || !data?.total} onClick={() => void exportCsv()}>
            {exporting ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Download size={15} aria-hidden />} Export CSV
          </button>
        }
      />
      <div className="card overflow-hidden">
        <div className="px-4 pt-3">
          <Tabs<Segment>
            label="Customer segment"
            value={segment}
            onChange={setSegment}
            items={[
              { value: "all", label: "All", count: segCount("all") },
              { value: "new", label: "New (30 days)", count: segCount("new") },
              { value: "repeat", label: "Repeat buyers", count: segCount("repeat") },
              { value: "vip", label: "High value", count: segCount("vip") },
              { value: "blocked", label: "Blocked", count: segCount("blocked") },
            ]}
          />
        </div>
        <Toolbar className="p-4">
          <SearchInput value={q} onChange={setQ} placeholder="Name, email or mobile" label="Search customers" className="sm:max-w-sm sm:flex-1" />
          <DateRangeFilter label="Joined" from={joined.from} to={joined.to} onChange={setJoined} className="sm:w-auto" />
          <p className="text-[13px] text-muted sm:ml-auto">
            {data?.total ?? 0} customer{data?.total === 1 ? "" : "s"}
            {segment === "vip" && ` · spent ${formatPrice(VIP_SPEND)}+`}
          </p>
        </Toolbar>
        {status === "loading" ? (
          <TableSkeleton />
        ) : status === "error" ? (
          <LoadError title="Couldn't load customers" message={error} onRetry={reload} />
        ) : (
          <DataTable
            caption="Customers"
            rows={rows}
            columns={columns}
            getRowId={(c) => c.id}
            sort={sort}
            onSortChange={setSort}
            server={{ page, totalPages: data?.totalPages ?? 1, total: data?.total ?? 0, limit: PAGE_SIZE, onPageChange: setPage, loading: refreshing }}
            empty={<TableEmpty icon={<Users size={24} />} title="No customers found" description="Try another segment, date range or search." />}
          />
        )}
      </div>
    </>
  );
}
