"use client";

import Link from "next/link";
import { Ban, CalendarDays, IndianRupee, Mail, MapPin, MessageCircle, Phone, ReceiptText, ShoppingBag, UserCheck, Users } from "lucide-react";
import { useState } from "react";
import type { AdminOrder, CustomerWithStats } from "@/types/admin";
import { getAudience } from "@/data/audiences";
import { useAdminQuery } from "@/hooks/use-admin-query";
import { adminApi, errorMessage } from "@/lib/admin-api";
import { formatDate, formatPrice } from "@/lib/utils";
import { useAdminSession } from "@/store/admin-store";
import { toast } from "@/store/ui-store";
import { Badge, OrderStatusBadge } from "../ui/Badge";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { DataTable, TableEmpty, type Column } from "../ui/DataTable";
import { TextAreaField } from "../ui/FormControls";
import { PageHeader } from "../ui/PageHeader";
import { Panel, StatCard } from "../ui/Panel";
import { LoadError } from "../ui/QueryState";
import { Avatar, VIP_SPEND } from "./CustomersView";

interface CustomerDetail {
  customer: CustomerWithStats;
  orders: AdminOrder[];
  orderTotal: number;
}

export function CustomerDetailView({ id }: { id: string }) {
  const valid = /^[a-f\d]{24}$/i.test(id);
  const { data, status, error, reload, replace } = useAdminQuery<CustomerDetail>(valid ? `/customers/${id}` : null);
  const canWrite = useAdminSession((s) => s.can("customers:write"));
  const customer = data?.customer;
  const history = data?.orders ?? [];
  const [notes, setNotes] = useState<string | null>(null);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async (patch: { status?: "active" | "blocked"; notes?: string }, message: string) => {
    setSaving(true);
    try {
      replace((await adminApi<CustomerDetail>(`/customers/${id}`, { method: "PATCH", body: patch })).data);
      setNotes(null);
      toast.success(message);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (valid && status === "loading") {
    return <div className="skeleton h-96 rounded-2xl" role="status" aria-label="Loading" />;
  }
  if (valid && status === "error" && !customer) {
    return (
      <div className="card">
        <LoadError title="Couldn't load this customer" message={error} onRetry={reload} />
      </div>
    );
  }
  if (!customer) {
    return (
      <div className="card py-16">
        <TableEmpty
          icon={<Users size={24} />}
          title="Customer not found"
          action={
            <Link href="/mm-hub/customers" className="btn-outline btn-sm">
              Back to customers
            </Link>
          }
        />
      </div>
    );
  }

  const blocked = customer.status === "blocked";
  const aov = customer.orderCount ? customer.totalSpent / customer.orderCount : 0;
  const noteValue = notes ?? customer.notes;

  const columns: Column<AdminOrder>[] = [
    {
      id: "id",
      header: "Order",
      sortValue: (o) => o.id,
      cell: (o) => (
        <Link href={`/mm-hub/orders/${o.id}`} className="font-semibold whitespace-nowrap hover:text-accent hover:underline">
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
      <PageHeader breadcrumbs={[{ label: "Customers", href: "/mm-hub/customers" }, { label: customer.fullName }]} title="Customer profile" />

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
            <button type="button" onClick={() => setConfirmBlock(true)} disabled={!canWrite || saving} className={blocked ? "btn-dark btn-sm" : "btn-ghost btn-sm text-danger hover:bg-danger-soft"}>
              {blocked ? <UserCheck size={15} aria-hidden /> : <Ban size={15} aria-hidden />}
              {blocked ? "Unblock" : "Block"}
            </button>
          </div>
        </div>
      </section>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Orders" value={customer.orderCount} icon={<ShoppingBag size={18} />} hint="paid" />
        <StatCard label="Total spent" value={formatPrice(customer.totalSpent)} icon={<IndianRupee size={18} />} tone="gold" hint="net of refunds" />
        <StatCard label="Average order" value={formatPrice(aov)} icon={<ReceiptText size={18} />} tone="royal" />
        <StatCard label="Last order" value={customer.lastOrderAt ? formatDate(customer.lastOrderAt).replace(/ \d{4}$/, "") : "—"} icon={<CalendarDays size={18} />} tone="success" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel title={`Order history${data && data.orderTotal > history.length ? ` (latest ${history.length} of ${data.orderTotal})` : ""}`} className="self-start xl:col-span-2" flush>
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
                <dd className="font-medium">{getAudience(customer.primaryAudience).label}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Marketing emails</dt>
                <dd>{customer.marketingOptIn ? <Badge tone="success">Subscribed</Badge> : <Badge tone="muted">Not subscribed</Badge>}</dd>
              </div>
            </dl>
          </Panel>

          <Panel title="Internal notes">
            <TextAreaField
              label="Notes about this customer"
              rows={3}
              maxLength={2000}
              value={noteValue}
              onChange={(e) => setNotes(e.target.value)}
              hint="Only staff can see this."
              disabled={!canWrite}
            />
            <button
              type="button"
              className="btn-dark btn-sm mt-3 w-full"
              disabled={!canWrite || saving || noteValue === customer.notes}
              onClick={() => void save({ notes: noteValue }, "Notes saved")}
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
            : "They'll be signed out everywhere and won't be able to sign in to their account. Existing orders are not affected."
        }
        confirmLabel={blocked ? "Unblock" : "Block customer"}
        destructive={!blocked}
        onConfirm={() => void save({ status: blocked ? "active" : "blocked" }, blocked ? "Customer unblocked" : "Customer blocked")}
      />
    </>
  );
}
