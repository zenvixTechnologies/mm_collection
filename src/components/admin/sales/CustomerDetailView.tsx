"use client";

import Link from "next/link";
import { Ban, CalendarDays, IndianRupee, Mail, MapPin, MessageCircle, Phone, ReceiptText, ShoppingBag, UserCheck, Users } from "lucide-react";
import { useMemo, useState } from "react";
import type { AdminOrder } from "@/types/admin";
import { customersWithStats } from "@/lib/admin/metrics";
import { formatDate, formatPrice } from "@/lib/utils";
import { useAdminStore } from "@/store/admin-store";
import { toast } from "@/store/ui-store";
import { Badge, OrderStatusBadge } from "../ui/Badge";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { DataTable, TableEmpty, type Column } from "../ui/DataTable";
import { TextAreaField } from "../ui/FormControls";
import { PageHeader } from "../ui/PageHeader";
import { Panel, StatCard } from "../ui/Panel";
import { Avatar, VIP_SPEND } from "./CustomersView";

export function CustomerDetailView({ id }: { id: string }) {
  const customers = useAdminStore((s) => s.customers);
  const orders = useAdminStore((s) => s.orders);
  const updateCustomer = useAdminStore((s) => s.updateCustomer);
  const customer = useMemo(() => customersWithStats(customers, orders).find((c) => c.id === id), [customers, orders, id]);
  const history = useMemo(() => orders.filter((o) => o.customerId === id), [orders, id]);
  const [notes, setNotes] = useState(customer?.notes ?? "");
  const [confirmBlock, setConfirmBlock] = useState(false);

  if (!customer) {
    return (
      <div className="card py-16">
        <TableEmpty
          icon={<Users size={24} />}
          title="Customer not found"
          action={
            <Link href="/admin/customers" className="btn-outline btn-sm">
              Back to customers
            </Link>
          }
        />
      </div>
    );
  }

  const blocked = customer.status === "blocked";
  const aov = customer.orderCount ? customer.totalSpent / Math.max(1, history.filter((o) => o.status !== "Cancelled").length) : 0;

  const columns: Column<AdminOrder>[] = [
    {
      id: "id",
      header: "Order",
      sortValue: (o) => o.id,
      cell: (o) => (
        <Link href={`/admin/orders/${o.id}`} className="font-semibold whitespace-nowrap hover:text-accent hover:underline">
          {o.id}
        </Link>
      ),
    },
    { id: "date", header: "Placed", sortValue: (o) => o.createdAt, cell: (o) => <span className="whitespace-nowrap text-muted">{formatDate(o.createdAt)}</span> },
    { id: "items", header: "Items", hideBelow: "md", cell: (o) => <span className="block max-w-[260px] truncate">{o.items.map((i) => i.name).join(", ")}</span> },
    { id: "status", header: "Status", cell: (o) => <OrderStatusBadge status={o.status} /> },
    { id: "total", header: "Total", align: "right", sortValue: (o) => o.total, cell: (o) => <span className="font-semibold tabular-nums">{formatPrice(o.total)}</span> },
  ];

  const waNumber = `91${customer.mobile}`;

  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Customers", href: "/admin/customers" }, { label: customer.fullName }]} title="Customer profile" />

      <section className="card relative mb-6 overflow-hidden p-5 sm:p-6" aria-label="Profile summary">
        <div className="gold-rule absolute inset-x-0 top-0 opacity-60" aria-hidden />
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <Avatar name={customer.fullName} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-3xl font-semibold">{customer.fullName}</h2>
              {blocked ? <Badge tone="danger">Blocked</Badge> : <Badge tone="success">Active</Badge>}
              {customer.totalSpent >= VIP_SPEND && <Badge tone="gold">High value</Badge>}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
              <span className="inline-flex items-center gap-1.5">
                <Mail size={14} aria-hidden /> {customer.email}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Phone size={14} aria-hidden /> +91 {customer.mobile}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays size={14} aria-hidden /> Joined {formatDate(customer.joinedAt)}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={`mailto:${customer.email}`} className="btn-outline btn-sm">
              <Mail size={15} aria-hidden /> Email
            </a>
            <a href={`https://wa.me/${waNumber}`} target="_blank" rel="noreferrer" className="btn-outline btn-sm">
              <MessageCircle size={15} aria-hidden /> WhatsApp
            </a>
            <button type="button" onClick={() => setConfirmBlock(true)} className={blocked ? "btn-dark btn-sm" : "btn-ghost btn-sm text-danger hover:bg-danger-soft"}>
              {blocked ? <UserCheck size={15} aria-hidden /> : <Ban size={15} aria-hidden />}
              {blocked ? "Unblock" : "Block"}
            </button>
          </div>
        </div>
      </section>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Orders" value={customer.orderCount} icon={<ShoppingBag size={18} />} />
        <StatCard label="Total spent" value={formatPrice(customer.totalSpent)} icon={<IndianRupee size={18} />} tone="gold" hint="excl. cancelled" />
        <StatCard label="Average order" value={formatPrice(aov)} icon={<ReceiptText size={18} />} tone="royal" />
        <StatCard label="Last order" value={customer.lastOrderAt ? formatDate(customer.lastOrderAt).replace(/ \d{4}$/, "") : "—"} icon={<CalendarDays size={18} />} tone="success" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel title="Order history" className="self-start xl:col-span-2" flush>
          <DataTable
            caption={`Orders by ${customer.fullName}`}
            rows={history}
            columns={columns}
            getRowId={(o) => o.id}
            pageSize={8}
            initialSort={{ id: "date", dir: "desc" }}
            empty={<TableEmpty icon={<ShoppingBag size={24} />} title="No orders yet" />}
          />
        </Panel>

        <div className="min-w-0 space-y-6">
          <Panel
            title={
              <span className="inline-flex items-center gap-2">
                <MapPin size={16} className="text-gold-dark" aria-hidden /> Addresses
              </span>
            }
          >
            <ul className="space-y-4">
              {customer.addresses.map((a, i) => (
                <li key={i} className="text-sm leading-6 text-muted">
                  {i === 0 && <span className="mb-1 inline-block rounded-full bg-sand px-2 py-0.5 text-[11px] font-semibold text-ink">Default</span>}
                  <address className="not-italic">
                    {a.house}, {a.street}
                    <br />
                    {a.city}, {a.district}
                    <br />
                    {a.state} – {a.pincode}
                  </address>
                </li>
              ))}
              {!customer.addresses.length && <li className="text-sm text-muted">No saved addresses.</li>}
            </ul>
          </Panel>

          <Panel title="Preferences">
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Shops mostly for</dt>
                <dd className="font-medium capitalize">{customer.primaryAudience}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Marketing emails</dt>
                <dd>{customer.marketingOptIn ? <Badge tone="success">Subscribed</Badge> : <Badge tone="muted">Not subscribed</Badge>}</dd>
              </div>
            </dl>
          </Panel>

          <Panel title="Internal notes">
            <TextAreaField label="Notes about this customer" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} hint="Only staff can see this." />
            <button
              type="button"
              className="btn-dark btn-sm mt-3 w-full"
              disabled={notes === customer.notes}
              onClick={() => {
                updateCustomer(customer.id, { notes });
                toast.success("Notes saved");
              }}
            >
              Save notes
            </button>
          </Panel>
        </div>
      </div>

      <ConfirmDialog
        open={confirmBlock}
        onClose={() => setConfirmBlock(false)}
        title={blocked ? `Unblock ${customer.fullName}?` : `Block ${customer.fullName}?`}
        description={
          blocked
            ? "They will be able to sign in and place orders again."
            : "They won't be able to sign in or place new orders. Existing orders are not affected."
        }
        confirmLabel={blocked ? "Unblock" : "Block customer"}
        destructive={!blocked}
        onConfirm={() => {
          updateCustomer(customer.id, { status: blocked ? "active" : "blocked" });
          toast.success(blocked ? "Customer unblocked" : "Customer blocked");
        }}
      />
    </>
  );
}
