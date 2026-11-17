"use client";

import Link from "next/link";
import { Ban, CreditCard, ExternalLink, Mail, MessageSquareText, Phone, Printer, ShoppingBag, Truck, User } from "lucide-react";
import { useMemo, useState } from "react";
import type { AdminOrderStatus } from "@/types/admin";
import { formatDate, formatPrice } from "@/lib/utils";
import { useAdminStore } from "@/store/admin-store";
import { toast } from "@/store/ui-store";
import { AddressBlock, OrderItems, OrderTimeline, OrderTotals } from "@/components/account/OrderParts";
import { OrderStatusBadge, PaymentStatusBadge } from "../ui/Badge";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { TableEmpty } from "../ui/DataTable";
import { SelectField, TextAreaField, TextField } from "../ui/FormControls";
import { PageHeader } from "../ui/PageHeader";
import { Panel } from "../ui/Panel";
import { timeAgo } from "../ui/format";
import { PAYMENT_METHOD_LABEL, nextStatuses, toStoreOrder } from "./sales-helpers";

function TrackingForm({ orderId }: { orderId: string }) {
  const order = useAdminStore((s) => s.orders.find((o) => o.id === orderId))!;
  const allCouriers = useAdminStore((s) => s.shipping.couriers);
  const couriers = useMemo(() => allCouriers.filter((c) => c.enabled), [allCouriers]);
  const setTracking = useAdminStore((s) => s.setTracking);
  const [courier, setCourier] = useState(order.tracking?.courier ?? couriers[0]?.name ?? "");
  const [awb, setAwb] = useState(order.tracking?.awb ?? "");
  const [error, setError] = useState<string | null>(null);
  const template = couriers.find((c) => c.name === courier)?.trackingUrlTemplate;
  const url = template && awb ? template.replace("{awb}", encodeURIComponent(awb.trim())) : undefined;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!awb.trim()) {
          setError("Enter the AWB / tracking number.");
          return;
        }
        setError(null);
        setTracking(orderId, { courier, awb: awb.trim().toUpperCase(), url, shippedAt: order.tracking?.shippedAt ?? new Date().toISOString() });
        toast.success("Tracking details saved");
      }}
      className="space-y-3"
      noValidate
    >
      <SelectField label="Courier" value={courier} onChange={(e) => setCourier(e.target.value)} options={couriers.map((c) => ({ value: c.name, label: c.name }))} />
      <TextField label="AWB / tracking number" value={awb} error={error ?? undefined} onChange={(e) => setAwb(e.target.value)} placeholder="e.g. DE123456789" />
      {order.tracking?.url && (
        <a href={order.tracking.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:underline">
          Open courier tracking <ExternalLink size={13} aria-hidden />
        </a>
      )}
      <button type="submit" className="btn-outline btn-sm w-full">
        {order.tracking ? "Update tracking" : "Save tracking"}
      </button>
    </form>
  );
}

export function OrderDetailView({ id }: { id: string }) {
  const order = useAdminStore((s) => s.orders.find((o) => o.id === id));
  const payment = useAdminStore((s) => s.payments.find((p) => p.orderId === id));
  const updateOrderStatus = useAdminStore((s) => s.updateOrderStatus);
  const addOrderNote = useAdminStore((s) => s.addOrderNote);
  const options: AdminOrderStatus[] = order ? nextStatuses(order.status).filter((s) => s !== "Cancelled") : [];
  const [nextStatus, setNextStatus] = useState<AdminOrderStatus | "">(options[0] ?? "");
  const [note, setNote] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  if (!order) {
    return (
      <div className="card py-16">
        <TableEmpty
          icon={<ShoppingBag size={24} />}
          title="Order not found"
          description={`There's no order with the ID “${id}”.`}
          action={
            <Link href="/admin/orders" className="btn-outline btn-sm">
              Back to orders
            </Link>
          }
        />
      </div>
    );
  }

  const storeOrder = toStoreOrder(order);
  const canCancel = nextStatuses(order.status).includes("Cancelled");
  const selectedStatus = options.includes(nextStatus as AdminOrderStatus) ? (nextStatus as AdminOrderStatus) : options[0];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Orders", href: "/admin/orders" }, { label: order.id }]}
        title={`Order ${order.id}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            Placed {formatDate(order.createdAt, true)} · <OrderStatusBadge status={order.status} /> <PaymentStatusBadge status={order.paymentStatus} />
          </span>
        }
        actions={
          <>
            <button type="button" onClick={() => window.print()} className="btn-outline btn-sm">
              <Printer size={15} aria-hidden /> Print invoice
            </button>
            {canCancel && (
              <button type="button" onClick={() => setConfirmCancel(true)} className="btn-ghost btn-sm text-danger hover:bg-danger-soft">
                <Ban size={15} aria-hidden /> Cancel order
              </button>
            )}
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <Panel title="Progress">
            {order.status === "Cancelled" ? (
              <div className="flex gap-3 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
                <Ban size={18} className="mt-0.5 shrink-0" aria-hidden />
                <p>
                  Cancelled {order.history.Cancelled ? formatDate(order.history.Cancelled, true) : ""}. Payment status: <strong>{order.paymentStatus.replace("_", " ")}</strong>.
                </p>
              </div>
            ) : (
              <OrderTimeline order={storeOrder} />
            )}
          </Panel>

          <Panel title={`Items (${order.items.reduce((n, i) => n + i.quantity, 0)})`}>
            <OrderItems order={storeOrder} />
            <div className="mt-5 border-t border-line pt-5 sm:ml-auto sm:max-w-sm">
              <OrderTotals order={storeOrder} />
            </div>
          </Panel>

          <Panel
            title={
              <span className="inline-flex items-center gap-2">
                <MessageSquareText size={16} className="text-gold-dark" aria-hidden /> Staff notes
              </span>
            }
            description="Only visible to the store team."
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!note.trim()) return;
                addOrderNote(order.id, note.trim());
                setNote("");
                toast.success("Note added");
              }}
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
            >
              <TextAreaField className="flex-1" label="Add a note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Customer asked for gift wrapping" />
              <button type="submit" className="btn-dark btn-sm sm:mb-px" disabled={!note.trim()}>
                Add note
              </button>
            </form>
            {order.notes.length > 0 && (
              <ul className="mt-5 space-y-3">
                {order.notes.map((n) => (
                  <li key={n.id} className="rounded-xl bg-canvas px-4 py-3 text-sm">
                    <p className="leading-6">{n.text}</p>
                    <p className="mt-1 text-xs text-muted">
                      {n.author} · {timeAgo(n.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="min-w-0 space-y-6">
          <Panel title="Update status">
            {options.length ? (
              <div className="space-y-3">
                <SelectField
                  label="Move order to"
                  value={selectedStatus}
                  onChange={(e) => {
                    setNextStatus(e.target.value as AdminOrderStatus);
                    setStatusError(null);
                  }}
                  options={options.map((s) => ({ value: s, label: s }))}
                  error={statusError ?? undefined}
                />
                <button
                  type="button"
                  className="btn-primary btn-sm w-full"
                  onClick={() => {
                    if (selectedStatus === "Shipped" && !order.tracking) {
                      setStatusError("Add tracking details below before marking as shipped.");
                      return;
                    }
                    updateOrderStatus(order.id, selectedStatus);
                    setNextStatus("");
                    toast.success(`Order marked as ${selectedStatus}`);
                  }}
                >
                  Update status
                </button>
                <p className="text-xs leading-5 text-muted">The customer sees the new status on their order tracking page (once the backend is connected).</p>
              </div>
            ) : (
              <p className="text-sm text-muted">
                This order is <strong className="text-ink">{order.status.toLowerCase()}</strong> — no further updates.
              </p>
            )}
          </Panel>

          <Panel
            title={
              <span className="inline-flex items-center gap-2">
                <Truck size={16} className="text-gold-dark" aria-hidden /> Shipment
              </span>
            }
            description="Shipping Charges Applicable"
          >
            {order.status === "Cancelled" ? <p className="text-sm text-muted">Cancelled orders aren&apos;t shipped.</p> : <TrackingForm key={order.tracking?.awb ?? "none"} orderId={order.id} />}
          </Panel>

          <Panel
            title={
              <span className="inline-flex items-center gap-2">
                <User size={16} className="text-gold-dark" aria-hidden /> Customer
              </span>
            }
            action={
              <Link href={`/admin/customers/${order.customerId}`} className="text-[13px] font-semibold text-accent hover:underline">
                Profile
              </Link>
            }
          >
            <p className="font-semibold">{order.customer.fullName}</p>
            <a href={`mailto:${order.customer.email}`} className="mt-2 flex items-center gap-2 text-sm text-muted hover:text-ink">
              <Mail size={14} aria-hidden /> {order.customer.email}
            </a>
            <a href={`tel:+91${order.customer.mobile}`} className="mt-1 flex items-center gap-2 text-sm text-muted hover:text-ink">
              <Phone size={14} aria-hidden /> +91 {order.customer.mobile}
            </a>
            <div className="mt-4 border-t border-line pt-4">
              <p className="mb-1.5 text-xs font-semibold tracking-[0.12em] text-muted uppercase">Ship to</p>
              <AddressBlock order={storeOrder} />
            </div>
          </Panel>

          <Panel
            title={
              <span className="inline-flex items-center gap-2">
                <CreditCard size={16} className="text-gold-dark" aria-hidden /> Payment
              </span>
            }
            action={
              <Link href={`/admin/payments?q=${order.id}`} className="text-[13px] font-semibold text-accent hover:underline">
                Details
              </Link>
            }
          >
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Status</dt>
                <dd>
                  <PaymentStatusBadge status={order.paymentStatus} />
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Method</dt>
                <dd className="text-right">
                  {PAYMENT_METHOD_LABEL[order.paymentMethod]}
                  {payment && <span className="block text-xs text-muted">{payment.methodDetail}</span>}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Amount</dt>
                <dd className="font-semibold tabular-nums">{formatPrice(order.payment?.amount ?? order.total)}</dd>
              </div>
              {order.payment && (
                <div className="border-t border-line pt-2.5">
                  <dt className="text-xs text-muted">Razorpay payment ID</dt>
                  <dd className="font-mono text-xs break-all">{order.payment.razorpayPaymentId}</dd>
                </div>
              )}
            </dl>
          </Panel>
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title={`Cancel order ${order.id}?`}
        description={
          <>
            The order will be marked as cancelled and removed from revenue. Refund the payment from <strong className="text-ink">Payments</strong> — in this demo
            no money moves.
          </>
        }
        confirmLabel="Cancel order"
        onConfirm={() => {
          updateOrderStatus(order.id, "Cancelled");
          toast.success("Order cancelled");
        }}
      />
    </>
  );
}
