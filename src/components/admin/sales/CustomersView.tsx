"use client";

import Link from "next/link";
import { Download, Users } from "lucide-react";
import { useMemo, useState } from "react";
import type { CustomerWithStats } from "@/types/admin";
import { MOCK_NOW } from "@/data/admin/mock-utils";
import { customersWithStats } from "@/lib/admin/metrics";
import { formatDate, formatPrice } from "@/lib/utils";
import { useAdminStore } from "@/store/admin-store";
import { toast } from "@/store/ui-store";
import { Badge } from "../ui/Badge";
import { downloadCsv } from "../ui/csv";
import { DataTable, TableEmpty, type Column } from "../ui/DataTable";
import { initials } from "../ui/format";
import { PageHeader } from "../ui/PageHeader";
import { SearchInput, Tabs, Toolbar } from "../ui/Toolbar";

type Segment = "all" | "new" | "repeat" | "vip" | "blocked";

/** Spend at which a customer counts as high value. */
export const VIP_SPEND = 10_000;

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

function inSegment(c: CustomerWithStats, s: Segment) {
  switch (s) {
    case "new":
      return MOCK_NOW.getTime() - new Date(c.joinedAt).getTime() <= 30 * 86_400_000;
    case "repeat":
      return c.orderCount >= 2;
    case "vip":
      return c.totalSpent >= VIP_SPEND;
    case "blocked":
      return c.status === "blocked";
    default:
      return true;
  }
}

export function CustomersView() {
  const customers = useAdminStore((s) => s.customers);
  const orders = useAdminStore((s) => s.orders);
  const [segment, setSegment] = useState<Segment>("all");
  const [q, setQ] = useState("");
  const rows = useMemo(() => customersWithStats(customers, orders), [customers, orders]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter(
      (c) =>
        inSegment(c, segment) &&
        (!term || c.fullName.toLowerCase().includes(term) || c.email.toLowerCase().includes(term) || c.mobile.includes(term) || c.addresses[0]?.city.toLowerCase().includes(term)),
    );
  }, [rows, segment, q]);

  const segCount = (s: Segment) => rows.filter((c) => inSegment(c, s)).length;

  const columns: Column<CustomerWithStats>[] = [
    {
      id: "name",
      header: "Customer",
      sortValue: (c) => c.fullName,
      cell: (c) => (
        <div className="flex min-w-[200px] items-center gap-3">
          <Avatar name={c.fullName} />
          <div className="min-w-0">
            <Link href={`/admin/customers/${c.id}`} className="font-semibold hover:text-accent hover:underline">
              {c.fullName}
            </Link>
            <p className="truncate text-xs text-muted">{c.email}</p>
          </div>
        </div>
      ),
    },
    { id: "mobile", header: "Mobile", hideBelow: "lg", cell: (c) => <span className="whitespace-nowrap tabular-nums">+91 {c.mobile}</span> },
    { id: "city", header: "Location", hideBelow: "xl", sortValue: (c) => c.addresses[0]?.city ?? "", cell: (c) => <span className="whitespace-nowrap">{c.addresses[0] ? `${c.addresses[0].city}, ${c.addresses[0].state}` : "—"}</span> },
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
      sortValue: (c) => c.status,
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
          <button
            type="button"
            className="btn-outline btn-sm"
            onClick={() => {
              downloadCsv(
                "mm-customers.csv",
                ["Name", "Email", "Mobile", "City", "Orders", "Total spent", "Joined", "Marketing opt-in", "Status"],
                filtered.map((c) => [c.fullName, c.email, c.mobile, c.addresses[0]?.city, c.orderCount, c.totalSpent, c.joinedAt, c.marketingOptIn ? "yes" : "no", c.status]),
              );
              toast.success(`Exported ${filtered.length} customers`);
            }}
          >
            <Download size={15} aria-hidden /> Export CSV
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
          <SearchInput value={q} onChange={setQ} placeholder="Name, email, mobile or city" label="Search customers" className="sm:max-w-sm sm:flex-1" />
          <p className="text-[13px] text-muted sm:ml-auto">
            {filtered.length} customer{filtered.length === 1 ? "" : "s"}
            {segment === "vip" && ` · spent ${formatPrice(VIP_SPEND)}+`}
          </p>
        </Toolbar>
        <DataTable
          caption="Customers"
          rows={filtered}
          columns={columns}
          getRowId={(c) => c.id}
          resetKey={`${segment}|${q}`}
          initialSort={{ id: "spent", dir: "desc" }}
          empty={<TableEmpty icon={<Users size={24} />} title="No customers found" description="Try another segment or search." />}
        />
      </div>
    </>
  );
}
