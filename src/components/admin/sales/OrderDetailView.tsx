"use client";

import Link from "next/link";
import { AlertTriangle, Ban, CreditCard, Loader2, Mail, MessageSquareText, Phone, Printer, ShoppingBag, User } from "lucide-react";
import { useState } from "react";
import type { AdminOrder, AdminOrderStatus } from "@/types/admin";
import { useAdminQuery } from "@/hooks/use-admin-query";
import { AdminApiError, adminApi, errorMessage } from "@/lib/admin-api";
import { formatDate, formatPrice } from "@/lib/utils";
import { useAdminSession } from "@/store/admin-store";
import { toast } from "@/store/ui-store";
import { AddressBlock, OrderItems, OrderTimeline, OrderTotals } from "@/components/account/OrderParts";
import { OrderStatusBadge, PaymentStatusBadge } from "../ui/Badge";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { TableEmpty } from "../ui/DataTable";
import { SelectField, TextAreaField } from "../ui/FormControls";
import { PageHeader } from "../ui/PageHeader";
import { Panel } from "../ui/Panel";
import { LoadError } from "../ui/QueryState";
import { timeAgo } from "../ui/format";
import { OrderReturnsPanel } from "./OrderReturnsPanel";
import { PAYMENT_METHOD_LABEL, toStoreOrder } from "./sales-helpers";

interface OrderDetail {
  order: AdminOrder;
  payment: { paymentId: string | null; method: string | null; methodDetail: string; razorpayOrderId: string | null; razorpayPaymentId: string | null; attempts: number };
}

const SIDE_STATUSES: AdminOrderStatus[] = ["Cancelled", "Payment Pending", "Payment Failed", "Expired"];

/** Moves the customer sees as a shipping milestone are confirmed first. */
const CONFIRM_STATUSES: AdminOrderStatus[] = ["Shipped", "Out for Delivery", "Delivered"];

export function OrderDetailView({ id }: { id: string }) {
  const valid = /^MM[A-Z0-9]{4,12}$/.test(id);
  const { data, status, error, reload, replace } = useAdminQuery<OrderDetail>(valid ? `/orders/${id}` : null);
  const canWrite = useAdminSession((s) => s.can("orders:write"));
  const [nextStatus, setNextStatus] = useState<AdminOrderStatus | "">("");
  const [note, setNote] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState<AdminOrderStatus | null>(null);
  const [statusNote, setStatusNote] = useState("");
  const [statusError, setStatusError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"status" | "note" | null>(null);

  if (valid && status === "loading") return <div className="skeleton h-96 rounded-2xl" role="status" aria-label="Loading" />;
  if (valid && status === "error" && !data) {
    return (
      <div className="card">
        <LoadError title="Couldn't load this order" message={error} onRetry={reload} />
      </div>
    );
  }
  const order = data?.order;
  if (!order || !data) {
    return (
      <div className="card py-16">
        <TableEmpty
          icon={<ShoppingBag size={24} />}
          title="Order not found"
          description={`There's no order with the ID “${id}”.`}
          action={
            <Link href="/mm-hub/orders" className="btn-outline btn-sm">
              Back to orders
            </Link>
          }
        />
      </div>
    );
  }

  const storeOrder = toStoreOrder(order);
  const allowed = order.allowedTransitions ?? [];
  const options: AdminOrderStatus[] = allowed.filter((s) => s !== "Cancelled");
  const canCancel = canWrite && allowed.includes("Cancelled");
  const selectedStatus = options.includes(nextStatus as AdminOrderStatus) ? (nextStatus as AdminOrderStatus) : options[0];
  const paid = order.paymentStatus === "captured" || order.paymentStatus === "partially_refunded";
  const sideStatus = SIDE_STATUSES.includes(order.status);

  const changeStatus = async (to: AdminOrderStatus, successMessage: string) => {
    setBusy("status");
    setStatusError(null);
    try {
      replace((await adminApi<OrderDetail>(`/orders/${order.id}/status`, { method: "PATCH", body: { status: to, note: statusNote.trim() } })).data);
      setNextStatus("");
      setStatusNote("");
      toast.success(successMessage);
    } catch (err) {
      setStatusError(errorMessage(err));
      toast.error(errorMessage(err));
      if (err instanceof AdminApiError && err.status === 409) reload();
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Orders", href: "/mm-hub/orders" }, { label: order.id }]}
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
              <button type="button" onClick={() => setConfirmCancel(true)} disabled={busy === "status"} className="btn-ghost btn-sm text-danger hover:bg-danger-soft">
                <Ban size={15} aria-hidden /> Cancel order
              </button>
            )}
          </>
        }
      />

      {order.exception && (
        <div className="mb-6 flex gap-3 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />
          <p>
            <strong>Needs attention ({order.exception.code.replace(/_/g, " ").toLowerCase()}):</strong> {order.exception.message}
          </p>
        </div>
      )}

      {order.cancellation && (
        <Panel className="mb-6" title="Cancelled by the customer">
          <dl className="space-y-1.5 text-sm">
            <div>
              <dt className="inline text-muted">Reason: </dt>
              <dd className="inline font-medium break-words">
                {order.cancellation.reason}
                {order.cancellation.otherReason && ` — ${order.cancellation.otherReason}`}
              </dd>
            </div>
            {order.cancellation.details && (
              <div>
                <dt className="inline text-muted">Additional details: </dt>
                <dd className="inline break-words whitespace-pre-line">{order.cancellation.details}</dd>
              </div>
            )}
            <div>
              <dt className="inline text-muted">Requested: </dt>
              <dd className="inline">
                {formatDate(order.cancellation.requestedAt, true)}, while the order was {order.cancellation.statusAtRequest}
              </dd>
            </div>
          </dl>
          {paid && (
            <p className="mt-3 text-sm text-warning">
              This payment hasn&apos;t been refunded.{" "}
              <Link href={`/mm-hub/payments?q=${order.id}`} className="font-semibold underline">
                Refund it from Payments
              </Link>
              .
            </p>
          )}
        </Panel>
      )}
      <OrderReturnsPanel orderId={order.id} />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <Panel title="Progress">
            {sideStatus && (
              <div className={`mb-5 flex gap-3 rounded-xl px-4 py-3 text-sm ${order.status === "Payment Pending" ? "bg-gold-soft text-warning" : "bg-danger-soft text-danger"}`}>
                <Ban size={18} className="mt-0.5 shrink-0" aria-hidden />
                <p>
                  {order.status === "Payment Pending"
                    ? `Waiting for payment${order.reservedUntil ? ` — items reserved until ${formatDate(order.reservedUntil, true)}` : ""}.`
                    : `${order.status}${order.history[order.status] ? ` ${formatDate(order.history[order.status]!, true)}` : ""}.`}{" "}
                  Payment status: <strong>{order.paymentStatus.replace("_", " ")}</strong>.
                </p>
              </div>
            )}
            {!sideStatus || order.status === "Cancelled" ? <OrderTimeline order={storeOrder} /> : null}
            {order.timeline && order.timeline.length > 0 && (
              <ol className="mt-6 space-y-1.5 border-t border-line pt-4 text-[13px]" aria-label="Status history">
                {order.timeline.map((t, i) => (
                  <li key={i} className="flex flex-wrap justify-between gap-x-3 text-muted">
                    <span>
                      {t.from && <>{t.from} → </>}
                      <strong className="text-ink">{t.status}</strong> · {t.by}
                      {t.note && <span> — {t.note}</span>}
                    </span>
                    <span className="tabular-nums">{formatDate(t.at, true)}</span>
                  </li>
                ))}
              </ol>
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
            {canWrite && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!note.trim()) return;
                  setBusy("note");
                  try {
                    replace((await adminApi<OrderDetail>(`/orders/${order.id}/notes`, { method: "POST", body: { text: note.trim() } })).data);
                    setNote("");
                    toast.success("Note added");
                  } catch (err) {
                    toast.error(errorMessage(err));
                  } finally {
                    setBusy(null);
                  }
                }}
                className="flex flex-col gap-2 sm:flex-row sm:items-end"
              >
                <TextAreaField className="flex-1" label="Add a note" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Customer asked for gift wrapping" />
                <button type="submit" className="btn-dark btn-sm sm:mb-px" disabled={!note.trim() || busy === "note"}>
                  {busy === "note" && <Loader2 size={14} className="animate-spin" aria-hidden />} Add note
                </button>
              </form>
            )}
            {order.notes.length > 0 ? (
              <ul className="mt-5 space-y-3">
                {order.notes.map((n) => (
                  <li key={n.id} className="rounded-xl bg-canvas px-4 py-3 text-sm">
                    <p className="leading-6 whitespace-pre-line">{n.text}</p>
                    <p className="mt-1 text-xs text-muted">
                      {n.author} · {timeAgo(n.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              !canWrite && <p className="text-sm text-muted">No notes yet.</p>
            )}
          </Panel>
        </div>

        <div className="min-w-0 space-y-6">
          <Panel title="Update status">
            {options.length && canWrite ? (
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
                <TextAreaField
                  label="Internal note (optional)"
                  rows={2}
                  maxLength={500}
                  value={statusNote}
                  onChange={(e) => setStatusNote(e.target.value)}
                  hint="Saved in the status history. Customers never see it."
                />
                <button
                  type="button"
                  className="btn-primary btn-sm w-full"
                  disabled={busy === "status"}
                  onClick={() => {
                    if (CONFIRM_STATUSES.includes(selectedStatus)) setConfirmStatus(selectedStatus);
                    else void changeStatus(selectedStatus, `Order marked as ${selectedStatus}`);
                  }}
                >
                  {busy === "status" && <Loader2 size={14} className="animate-spin" aria-hidden />} Update status
                </button>
                <p className="text-xs leading-5 text-muted">The customer sees the new status on their order tracking page.</p>
              </div>
            ) : (
              <p className="text-sm text-muted">
                {order.status === "Payment Pending"
                  ? "Fulfilment starts once the payment is confirmed by Razorpay."
                  : !canWrite && options.length
                    ? "You can view this order but not change it."
                    : <>This order is <strong className="text-ink">{order.status.toLowerCase()}</strong> — no further updates.</>}
              </p>
            )}
          </Panel>

          <Panel
            title={
              <span className="inline-flex items-center gap-2">
                <User size={16} className="text-gold-dark" aria-hidden /> Customer
              </span>
            }
            action={
              order.customerId ? (
                <Link href={`/mm-hub/customers/${order.customerId}`} className="text-[13px] font-semibold text-accent hover:underline">
                  Profile
                </Link>
              ) : (
                <span className="text-xs text-muted">Guest checkout</span>
              )
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
              data.payment.paymentId ? (
                <Link href={`/mm-hub/payments?q=${order.id}`} className="text-[13px] font-semibold text-accent hover:underline">
                  Details
                </Link>
              ) : undefined
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
                  {data.payment.methodDetail && <span className="block text-xs text-muted">{data.payment.methodDetail}</span>}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Amount</dt>
                <dd className="font-semibold tabular-nums">{formatPrice(order.payment?.amount ?? order.total)}</dd>
              </div>
              {!!order.refunded && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Refunded</dt>
                  <dd className="font-semibold text-danger tabular-nums">− {formatPrice(order.refunded)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Attempts</dt>
                <dd className="tabular-nums">{data.payment.attempts}</dd>
              </div>
              {data.payment.razorpayPaymentId && (
                <div className="border-t border-line pt-2.5">
                  <dt className="text-xs text-muted">Razorpay payment ID</dt>
                  <dd className="font-mono text-xs break-all">{data.payment.razorpayPaymentId}</dd>
                </div>
              )}
            </dl>
          </Panel>
        </div>
      </div>

      <ConfirmDialog
        open={confirmStatus !== null}
        onClose={() => setConfirmStatus(null)}
        title={`Mark order ${order.id} as ${confirmStatus}?`}
        description="The customer will see this on their order tracking page. Status moves can't be undone."
        confirmLabel={`Mark as ${confirmStatus}`}
        destructive={false}
        onConfirm={() => {
          if (confirmStatus) void changeStatus(confirmStatus, `Order marked as ${confirmStatus}`);
        }}
      />

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title={`Cancel order ${order.id}?`}
        description={
          paid ? (
            <>
              The order is marked as cancelled and its items go back into stock. The payment is <strong className="text-ink">not refunded automatically</strong> — refund it
              from <strong className="text-ink">Payments</strong>.
            </>
          ) : (
            <>We&apos;ll first check with Razorpay that no payment went through, then release the reserved items and any coupon use.</>
          )
        }
        confirmLabel="Cancel order"
        onConfirm={() => void changeStatus("Cancelled", "Order cancelled")}
      />
    </>
  );
}
