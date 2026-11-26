"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle, CheckCircle2, ChevronRight, CircleDollarSign, CreditCard, Download, ExternalLink, Info, Loader2, RefreshCw, RotateCcw, ShieldCheck, XCircle } from "lucide-react";
import { useRef, useState } from "react";
import type { AdminPage, PaymentDetailView, PaymentTransaction } from "@/types/admin";
import { useAdminQuery, withQuery } from "@/hooks/use-admin-query";
import { useDebounced } from "@/hooks/use-debounced";
import { adminApi, errorMessage } from "@/lib/admin-api";
import { formatDate, formatPrice } from "@/lib/utils";
import { useAdminSession } from "@/store/admin-store";
import { toast } from "@/store/ui-store";
import { Dialog } from "@/components/ui/Dialog";
import { Badge, OrderStatusBadge, PaymentStatusBadge } from "../ui/Badge";
import { downloadCsv } from "../ui/csv";
import { DataTable, TableEmpty, type Column, type SortState } from "../ui/DataTable";
import { TextAreaField, TextField } from "../ui/FormControls";
import { formatCompactPrice } from "../ui/format";
import { PageHeader } from "../ui/PageHeader";
import { StatCard } from "../ui/Panel";
import { LoadError, TableSkeleton } from "../ui/QueryState";
import { FilterSelect, SearchInput, Tabs, Toolbar } from "../ui/Toolbar";
import { PAYMENT_METHOD_LABEL } from "./sales-helpers";

type Tab = "all" | "paid" | "failed" | "refunded";
interface Summary {
  collected: number;
  successful: number;
  failed: number;
  refunded: number;
  successRate: number;
  counts: Record<Tab, number>;
}
type PaymentPage = AdminPage<PaymentTransaction> & { summary: Summary };

const PAGE_SIZE = 20;
const VERIFIED_LABEL = { verify: "Checkout signature verified", webhook: "Razorpay webhook", reconcile: "Confirmed with Razorpay" } as const;

function newKey() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function PaymentDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data, status, error, reload, replace } = useAdminQuery<PaymentDetailView>(`/payments/${id}`);
  const canRefund = useAdminSession((s) => s.can("payments:refund"));
  const [refunding, setRefunding] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const attemptKey = useRef<string | null>(null);

  if (status === "loading") return <div className="skeleton m-5 h-96 rounded-2xl" role="status" aria-label="Loading" />;
  if (status === "error" || !data) return <LoadError title="Couldn't load this payment" message={error} onRetry={reload} />;

  const { payment, refunds, failures, webhooks, refundable } = data;
  const net = payment.status === "failed" || payment.status === "created" ? 0 : payment.amount - payment.fee - payment.refundedAmount;
  const steps = [
    { label: `Attempt ${payment.attempt ?? 1} created`, icon: CircleDollarSign, bad: false },
    ...failures.map((f) => ({ label: `Failed — ${f.description ?? f.code ?? "declined"}`, icon: XCircle, bad: true })),
    ...(payment.capturedAt ? [{ label: `Captured · ${payment.verifiedBy ? VERIFIED_LABEL[payment.verifiedBy] : "Razorpay"}`, icon: CheckCircle2, bad: false }] : []),
    ...refunds.map((r) => ({ label: `Refund ${formatPrice(r.amount)} — ${r.status}`, icon: RotateCcw, bad: r.status === "failed" })),
  ];

  const submitRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    const rupees = amount.trim() === "" ? refundable : Number(amount);
    if (!(rupees >= 1) || rupees > refundable || Math.round(rupees * 100) !== rupees * 100) {
      return setFormError(`Enter an amount between ₹1 and ${formatPrice(refundable)} (up to 2 decimals).`);
    }
    if (reason.trim().length < 3) return setFormError("Give a short reason for the refund.");
    setFormError(null);
    setBusy("refund");
    attemptKey.current ??= newKey();
    try {
      const res = await adminApi<PaymentDetailView>(`/payments/${id}/refunds`, {
        method: "POST",
        body: { amountPaise: Math.round(rupees * 100), reason: reason.trim(), idempotencyKey: attemptKey.current },
      });
      replace(res.data);
      attemptKey.current = null;
      setRefunding(false);
      setAmount("");
      setReason("");
      toast.success(res.message);
      onChanged();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const syncRefund = async (refundId: string) => {
    setBusy(refundId);
    try {
      replace((await adminApi<PaymentDetailView>(`/payments/${id}/refunds/${refundId}`, { method: "POST", body: {} })).data);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="px-5 py-5">
      <div className="rounded-2xl bg-royal p-5 text-white">
        <p className="text-xs tracking-[0.16em] text-gold-light/80 uppercase">Amount</p>
        <p className="mt-1 font-display text-4xl font-semibold">{formatPrice(payment.amount)}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <PaymentStatusBadge status={payment.status} />
          <span className="text-xs text-white/60">{formatDate(payment.createdAt, true)}</span>
        </div>
      </div>

      <ol className="mt-5 space-y-3">
        {steps.map((s, i) => (
          <li key={i} className="flex items-center gap-3 text-sm">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${s.bad ? "bg-danger-soft text-danger" : "bg-success-soft text-success"}`} aria-hidden>
              <s.icon size={15} />
            </span>
            {s.label}
          </li>
        ))}
      </ol>

      <dl className="mt-6 divide-y divide-line rounded-xl border border-line text-sm">
        {[
          ["Razorpay payment ID", <span key="p" className="font-mono text-xs break-all">{payment.razorpayPaymentId || "—"}</span>],
          ["Razorpay order ID", <span key="o" className="font-mono text-xs break-all">{payment.razorpayOrderId}</span>],
          [
            "Store order",
            payment.orderId ? (
              <span key="so" className="inline-flex flex-wrap items-center justify-end gap-2">
                <Link href={`/mm-hub/orders/${payment.orderId}`} onClick={onClose} className="font-semibold text-accent hover:underline">
                  {payment.orderId}
                </Link>
                {data.order && <OrderStatusBadge status={data.order.status} />}
              </span>
            ) : (
              <span key="so" className="text-muted">—</span>
            ),
          ],
          ["Customer", payment.customerName ? `${payment.customerName} · ${payment.email}` : "—"],
          ["Method", payment.status === "captured" || payment.refundedAmount ? `${PAYMENT_METHOD_LABEL[payment.method]}${payment.methodDetail ? ` · ${payment.methodDetail}` : ""}` : "—"],
          ["Razorpay fee + GST", payment.fee ? `− ${formatPrice(payment.fee)}` : "—"],
          ["Refunded", payment.refundedAmount ? `− ${formatPrice(payment.refundedAmount)}` : "—"],
          ["Net settlement", <strong key="n">{formatPrice(net)}</strong>],
          ["Mode", <Badge key="m" tone={payment.mode === "live" ? "success" : "gold"}>{payment.mode === "live" ? "Live" : "Test"}</Badge>],
        ].map(([k, v]) => (
          <div key={k as string} className="flex items-start justify-between gap-4 px-4 py-2.5">
            <dt className="shrink-0 text-muted">{k}</dt>
            <dd className="min-w-0 text-right">{v}</dd>
          </div>
        ))}
      </dl>

      {payment.razorpayPaymentId && (
        <a
          href={`https://dashboard.razorpay.com/app/payments/${payment.razorpayPaymentId}`}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent hover:underline"
        >
          Open in Razorpay Dashboard <ExternalLink size={13} aria-hidden />
        </a>
      )}

      {refunds.length > 0 && (
        <section className="mt-6" aria-labelledby="refunds-heading">
          <h3 id="refunds-heading" className="mb-2 text-sm font-semibold">
            Refunds
          </h3>
          <ul className="divide-y divide-line rounded-xl border border-line text-sm">
            {refunds.map((r) => (
              <li key={r.razorpayRefundId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="font-semibold tabular-nums">{formatPrice(r.amount)}</span>{" "}
                  <Badge tone={r.status === "processed" ? "success" : r.status === "failed" ? "danger" : "warning"}>{r.status}</Badge>
                  <span className="block truncate font-mono text-xs text-muted">{r.razorpayRefundId}</span>
                  <span className="block text-xs text-muted">
                    {r.reason || "—"} · {r.by ?? "—"}
                    {r.createdAt ? ` · ${formatDate(r.createdAt, true)}` : ""}
                  </span>
                </span>
                {r.status === "pending" && (
                  <button type="button" className="btn-ghost btn-sm" disabled={busy === r.razorpayRefundId} onClick={() => void syncRefund(r.razorpayRefundId)}>
                    {busy === r.razorpayRefundId ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <RefreshCw size={14} aria-hidden />} Check status
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {webhooks.length > 0 && (
        <section className="mt-6" aria-labelledby="webhooks-heading">
          <h3 id="webhooks-heading" className="mb-2 text-sm font-semibold">
            Webhook events
          </h3>
          <ul className="divide-y divide-line rounded-xl border border-line text-[13px]">
            {webhooks.map((w, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2 px-4 py-2">
                <span className="font-mono">{w.type}</span>
                <span className="text-muted">
                  {w.status}
                  {w.attempts > 1 ? ` · ${w.attempts} deliveries` : ""} · {formatDate(w.at, true)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canRefund && refundable > 0 && (
        <div className="mt-6 border-t border-line pt-5">
          {!refunding ? (
            <button type="button" className="btn-outline btn-sm w-full" onClick={() => setRefunding(true)}>
              <RotateCcw size={15} aria-hidden /> Refund payment
            </button>
          ) : (
            <form onSubmit={(e) => void submitRefund(e)} className="space-y-3" noValidate>
              <div className="flex gap-2 rounded-xl bg-gold-soft px-3 py-2.5 text-xs leading-5 text-ink">
                <Info size={15} className="mt-0.5 shrink-0 text-gold-dark" aria-hidden />
                {payment.mode === "live"
                  ? "This sends real money back to the customer through Razorpay. It can't be undone."
                  : "Test Mode — Razorpay processes the refund without moving real money."}
              </div>
              <TextField
                label="Refund amount"
                prefix="₹"
                type="number"
                min={1}
                max={refundable}
                step="0.01"
                value={amount}
                placeholder={String(refundable)}
                hint={`Leave empty to refund everything left (${formatPrice(refundable)})`}
                onChange={(e) => setAmount(e.target.value)}
              />
              <TextAreaField label="Reason" rows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Item out of stock after payment" error={formError ?? undefined} />
              <div className="flex gap-2">
                <button type="button" className="btn-ghost btn-sm flex-1" onClick={() => setRefunding(false)} disabled={busy === "refund"}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary btn-sm flex-1" disabled={busy === "refund"}>
                  {busy === "refund" && <Loader2 size={14} className="animate-spin" aria-hidden />} Refund via Razorpay
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

export function PaymentsView() {
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.get("status") === "failed" ? "failed" : "all");
  const [q, setQ] = useState(params.get("q") ?? "");
  const [method, setMethod] = useState<"all" | PaymentTransaction["method"]>("all");
  const [sort, setSort] = useState<SortState>({ id: "pay", dir: "desc" });
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const term = useDebounced(q.trim());
  const filters = { q: term, group: tab === "all" ? undefined : tab, method: method === "all" ? undefined : method, sort: sort.id === "amount" ? "amount" : "created", dir: sort.dir };
  const filterKey = JSON.stringify(filters);
  const [lastKey, setLastKey] = useState(filterKey);
  if (filterKey !== lastKey) {
    setLastKey(filterKey);
    setPage(1);
  }
  const { data, status, error, refreshing, reload } = useAdminQuery<PaymentPage>(withQuery("/payments", { ...filters, page, limit: PAGE_SIZE }));
  const rows = data?.items ?? [];
  const summary = data?.summary;

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all: PaymentTransaction[] = [];
      for (let p = 1; p <= 100; p++) {
        const res = await adminApi<PaymentPage>(withQuery("/payments", { ...filters, page: p, limit: 100 }));
        all.push(...res.data.items);
        if (p >= res.data.totalPages) break;
      }
      downloadCsv(
        "mm-payments.csv",
        ["Payment ID", "Razorpay order", "Store order", "Attempt", "Date", "Customer", "Method", "Amount", "Fee", "Refunded", "Status", "Mode"],
        all.map((p) => [p.razorpayPaymentId, p.razorpayOrderId, p.orderId, p.attempt, p.createdAt, p.customerName, p.method, p.amount, p.fee, p.refundedAmount, p.status, p.mode]),
      );
      toast.success(`Exported ${all.length} payments`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<PaymentTransaction>[] = [
    {
      id: "pay",
      header: "Payment",
      sortValue: (p) => p.createdAt,
      cell: (p) => (
        <button type="button" onClick={() => setOpenId(p.id)} className="text-left">
          <span className="block font-mono text-[13px] font-semibold hover:text-accent hover:underline">{p.razorpayPaymentId || p.razorpayOrderId}</span>
          <span className="text-xs text-muted">
            {formatDate(p.createdAt, true)}
            {p.attempt && p.attempt > 1 ? ` · attempt ${p.attempt}` : ""}
          </span>
        </button>
      ),
    },
    {
      id: "order",
      header: "Order",
      hideBelow: "md",
      cell: (p) =>
        p.orderId ? (
          <Link href={`/mm-hub/orders/${p.orderId}`} className="font-medium whitespace-nowrap hover:text-accent hover:underline">
            {p.orderId}
          </Link>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    { id: "customer", header: "Customer", hideBelow: "lg", cell: (p) => <span className="whitespace-nowrap">{p.customerName || "—"}</span> },
    {
      id: "method",
      header: "Method",
      hideBelow: "xl",
      cell: (p) =>
        p.status === "captured" || p.refundedAmount ? (
          <span className="whitespace-nowrap">
            {PAYMENT_METHOD_LABEL[p.method]}
            <span className="block text-xs text-muted">{p.methodDetail}</span>
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    { id: "amount", header: "Amount", align: "right", sortValue: (p) => p.amount, cell: (p) => <span className="font-semibold whitespace-nowrap tabular-nums">{formatPrice(p.amount)}</span> },
    {
      id: "status",
      header: "Status",
      cell: (p) => (
        <span className="flex flex-col items-start gap-0.5">
          <PaymentStatusBadge status={p.status} />
          {p.errorReason && <span className="hidden max-w-[200px] truncate text-xs text-muted xl:block">{p.errorReason}</span>}
        </span>
      ),
    },
    {
      id: "open",
      header: <span className="sr-only">Details</span>,
      align: "right",
      cell: (p) => (
        <button type="button" onClick={() => setOpenId(p.id)} className="icon-btn h-9 w-9 text-muted" aria-label={`Payment details ${p.razorpayPaymentId || p.razorpayOrderId}`}>
          <ChevronRight size={17} />
        </button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Payments" }]}
        title="Payments"
        description="Razorpay transactions for UPI, cards and net banking."
        actions={
          <button type="button" className="btn-outline btn-sm" disabled={exporting || !data?.total} onClick={() => void exportCsv()}>
            {exporting ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Download size={15} aria-hidden />} Export CSV
          </button>
        }
      />

      <div className="mb-6 flex gap-3 rounded-[var(--radius-card)] border border-gold-light bg-gold-soft px-4 py-3 text-sm leading-6">
        <ShieldCheck size={18} className="mt-0.5 shrink-0 text-gold-dark" aria-hidden />
        <p>
          Payments are created and verified on the server through Razorpay — only verified checkout callbacks and webhooks mark an order paid. Refunds made here go
          through Razorpay and are recorded from Razorpay&apos;s confirmation.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Collected (net of refunds)" value={formatCompactPrice(summary?.collected ?? 0)} icon={<CreditCard size={18} />} hint={formatPrice(summary?.collected ?? 0)} />
        <StatCard
          label="Successful payments"
          value={summary?.successful ?? 0}
          icon={<CheckCircle2 size={18} />}
          tone="success"
          hint={`${(summary?.successRate ?? 0).toFixed(1)}% of completed attempts`}
        />
        <StatCard label="Failed attempts" value={summary?.failed ?? 0} icon={<AlertCircle size={18} />} tone="royal" hint="customer can retry while reserved" />
        <StatCard label="Refunded" value={formatCompactPrice(summary?.refunded ?? 0)} icon={<RotateCcw size={18} />} tone="gold" hint={formatPrice(summary?.refunded ?? 0)} />
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 pt-3">
          <Tabs<Tab>
            label="Payment status"
            value={tab}
            onChange={setTab}
            items={[
              { value: "all", label: "All", count: summary?.counts.all ?? 0 },
              { value: "paid", label: "Paid", count: summary?.counts.paid ?? 0 },
              { value: "failed", label: "Failed", count: summary?.counts.failed ?? 0 },
              { value: "refunded", label: "Refunded", count: summary?.counts.refunded ?? 0 },
            ]}
          />
        </div>
        <Toolbar className="p-4">
          <SearchInput value={q} onChange={setQ} placeholder="Payment ID, order ID or customer" label="Search payments" className="sm:max-w-sm sm:flex-1" />
          <FilterSelect
            label="Method"
            value={method}
            onChange={setMethod}
            options={[
              { value: "all", label: "All methods" },
              { value: "upi", label: "UPI" },
              { value: "card", label: "Card" },
              { value: "netbanking", label: "Net banking" },
            ]}
          />
        </Toolbar>
        {status === "loading" ? (
          <TableSkeleton />
        ) : status === "error" ? (
          <LoadError title="Couldn't load payments" message={error} onRetry={reload} />
        ) : (
          <DataTable
            caption="Payments"
            rows={rows}
            columns={columns}
            getRowId={(p) => p.id}
            sort={sort}
            onSortChange={setSort}
            server={{ page, totalPages: data?.totalPages ?? 1, total: data?.total ?? 0, limit: PAGE_SIZE, onPageChange: setPage, loading: refreshing }}
            empty={<TableEmpty icon={<CreditCard size={24} />} title="No payments found" />}
          />
        )}
      </div>

      <Dialog open={openId !== null} onClose={() => setOpenId(null)} variant="right" size="lg" title="Payment details">
        {openId && <PaymentDetail key={openId} id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
      </Dialog>
    </>
  );
}
