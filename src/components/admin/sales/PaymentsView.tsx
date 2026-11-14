"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle, CheckCircle2, ChevronRight, CircleDollarSign, CreditCard, Download, ExternalLink, Info, RotateCcw, ShieldCheck, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import type { PaymentTransaction } from "@/types/admin";
import { formatDate, formatPrice } from "@/lib/utils";
import { useAdminStore } from "@/store/admin-store";
import { toast } from "@/store/ui-store";
import { Dialog } from "@/components/ui/Dialog";
import { Badge, PaymentStatusBadge } from "../ui/Badge";
import { downloadCsv } from "../ui/csv";
import { DataTable, TableEmpty, type Column } from "../ui/DataTable";
import { TextField } from "../ui/FormControls";
import { formatCompactPrice } from "../ui/format";
import { PageHeader } from "../ui/PageHeader";
import { StatCard } from "../ui/Panel";
import { FilterSelect, SearchInput, Tabs, Toolbar } from "../ui/Toolbar";
import { PAYMENT_METHOD_LABEL } from "./sales-helpers";

type Tab = "all" | "paid" | "failed" | "refunded";

function matchesTab(p: PaymentTransaction, t: Tab) {
  if (t === "paid") return p.status === "captured";
  if (t === "failed") return p.status === "failed";
  if (t === "refunded") return p.status === "refunded" || p.status === "partially_refunded";
  return true;
}

function PaymentDetail({ payment, onClose }: { payment: PaymentTransaction; onClose: () => void }) {
  const refund = useAdminStore((s) => s.refundPayment);
  const remaining = payment.amount - payment.refundedAmount;
  const refundable = (payment.status === "captured" || payment.status === "partially_refunded") && remaining > 0;
  const [refunding, setRefunding] = useState(false);
  const [amount, setAmount] = useState(String(remaining));
  const [error, setError] = useState<string | null>(null);
  const net = payment.status === "failed" ? 0 : payment.amount - payment.fee - payment.refundedAmount;

  const steps = [
    { label: "Payment created", done: true, icon: CircleDollarSign },
    payment.status === "failed"
      ? { label: `Failed — ${payment.errorReason ?? "declined"}`, done: true, icon: XCircle, bad: true }
      : { label: "Authorized & captured", done: true, icon: CheckCircle2 },
    ...(payment.refundedAmount > 0 ? [{ label: `Refunded ${formatPrice(payment.refundedAmount)}`, done: true, icon: RotateCcw }] : []),
  ];

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
        {steps.map((s) => (
          <li key={s.label} className="flex items-center gap-3 text-sm">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${"bad" in s && s.bad ? "bg-danger-soft text-danger" : "bg-success-soft text-success"}`} aria-hidden>
              <s.icon size={15} />
            </span>
            {s.label}
          </li>
        ))}
      </ol>

      <dl className="mt-6 divide-y divide-line rounded-xl border border-line text-sm">
        {[
          ["Razorpay payment ID", <span key="p" className="font-mono text-xs break-all">{payment.razorpayPaymentId}</span>],
          ["Razorpay order ID", <span key="o" className="font-mono text-xs break-all">{payment.razorpayOrderId}</span>],
          [
            "Store order",
            payment.orderId ? (
              <Link key="so" href={`/admin/orders/${payment.orderId}`} onClick={onClose} className="font-semibold text-accent hover:underline">
                {payment.orderId}
              </Link>
            ) : (
              <span key="so" className="text-muted">Not created (payment failed)</span>
            ),
          ],
          ["Customer", `${payment.customerName} · ${payment.email}`],
          ["Method", `${PAYMENT_METHOD_LABEL[payment.method]} · ${payment.methodDetail}`],
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

      <a
        href={`https://dashboard.razorpay.com/app/payments/${payment.razorpayPaymentId}`}
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent hover:underline"
      >
        Open in Razorpay Dashboard <ExternalLink size={13} aria-hidden />
      </a>

      {refundable && (
        <div className="mt-6 border-t border-line pt-5">
          {!refunding ? (
            <button type="button" className="btn-outline btn-sm w-full" onClick={() => setRefunding(true)}>
              <RotateCcw size={15} aria-hidden /> Refund payment
            </button>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const n = Math.round(Number(amount));
                if (!(n > 0) || n > remaining) {
                  setError(`Enter an amount between ₹1 and ${formatPrice(remaining)}.`);
                  return;
                }
                refund(payment.id, n);
                toast.success(`Demo refund of ${formatPrice(n)} recorded`);
                setRefunding(false);
              }}
              className="space-y-3"
              noValidate
            >
              <div className="flex gap-2 rounded-xl bg-gold-soft px-3 py-2.5 text-xs leading-5 text-ink">
                <Info size={15} className="mt-0.5 shrink-0 text-gold-dark" aria-hidden />
                Demo only — this updates the screen but no money is moved. Real refunds will go through Razorpay once the backend is connected.
              </div>
              <TextField label="Refund amount" prefix="₹" type="number" min={1} max={remaining} value={amount} error={error ?? undefined} hint={`Up to ${formatPrice(remaining)}`} onChange={(e) => setAmount(e.target.value)} />
              <div className="flex gap-2">
                <button type="button" className="btn-ghost btn-sm flex-1" onClick={() => setRefunding(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary btn-sm flex-1">
                  Record refund
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
  const payments = useAdminStore((s) => s.payments);
  const [tab, setTab] = useState<Tab>(params.get("status") === "failed" ? "failed" : "all");
  const [q, setQ] = useState(params.get("q") ?? "");
  const [method, setMethod] = useState<"all" | PaymentTransaction["method"]>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const open = payments.find((p) => p.id === openId) ?? null;

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return payments.filter(
      (p) =>
        matchesTab(p, tab) &&
        (method === "all" || p.method === method) &&
        (!term ||
          p.razorpayPaymentId.toLowerCase().includes(term) ||
          p.razorpayOrderId.toLowerCase().includes(term) ||
          (p.orderId ?? "").toLowerCase().includes(term) ||
          p.customerName.toLowerCase().includes(term) ||
          p.email.toLowerCase().includes(term)),
    );
  }, [payments, tab, method, q]);

  const captured = payments.filter((p) => p.status !== "failed");
  const collected = captured.reduce((s, p) => s + p.amount - p.refundedAmount, 0);
  const failed = payments.filter((p) => p.status === "failed").length;
  const refunded = payments.reduce((s, p) => s + p.refundedAmount, 0);
  const successRate = payments.length ? (captured.length / payments.length) * 100 : 0;

  const columns: Column<PaymentTransaction>[] = [
    {
      id: "pay",
      header: "Payment",
      sortValue: (p) => p.createdAt,
      cell: (p) => (
        <button type="button" onClick={() => setOpenId(p.id)} className="text-left">
          <span className="block font-mono text-[13px] font-semibold hover:text-accent hover:underline">{p.razorpayPaymentId}</span>
          <span className="text-xs text-muted">{formatDate(p.createdAt, true)}</span>
        </button>
      ),
    },
    {
      id: "order",
      header: "Order",
      hideBelow: "md",
      sortValue: (p) => p.orderId ?? "",
      cell: (p) =>
        p.orderId ? (
          <Link href={`/admin/orders/${p.orderId}`} className="font-medium whitespace-nowrap hover:text-accent hover:underline">
            {p.orderId}
          </Link>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    { id: "customer", header: "Customer", hideBelow: "lg", sortValue: (p) => p.customerName, cell: (p) => <span className="whitespace-nowrap">{p.customerName}</span> },
    {
      id: "method",
      header: "Method",
      hideBelow: "xl",
      sortValue: (p) => p.method,
      cell: (p) => (
        <span className="whitespace-nowrap">
          {PAYMENT_METHOD_LABEL[p.method]}
          <span className="block text-xs text-muted">{p.methodDetail}</span>
        </span>
      ),
    },
    { id: "amount", header: "Amount", align: "right", sortValue: (p) => p.amount, cell: (p) => <span className="font-semibold whitespace-nowrap tabular-nums">{formatPrice(p.amount)}</span> },
    {
      id: "status",
      header: "Status",
      sortValue: (p) => p.status,
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
        <button type="button" onClick={() => setOpenId(p.id)} className="icon-btn h-9 w-9 text-muted" aria-label={`Payment details ${p.razorpayPaymentId}`}>
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
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            Razorpay transactions for UPI, cards and net banking. <Badge tone="gold">Test mode</Badge>
          </span>
        }
        actions={
          <button
            type="button"
            className="btn-outline btn-sm"
            onClick={() => {
              downloadCsv(
                "mm-payments.csv",
                ["Payment ID", "Razorpay order", "Store order", "Date", "Customer", "Method", "Amount", "Fee", "Refunded", "Status"],
                filtered.map((p) => [p.razorpayPaymentId, p.razorpayOrderId, p.orderId, p.createdAt, p.customerName, p.method, p.amount, p.fee, p.refundedAmount, p.status]),
              );
              toast.success(`Exported ${filtered.length} payments`);
            }}
          >
            <Download size={15} aria-hidden /> Export CSV
          </button>
        }
      />

      <div className="mb-6 flex gap-3 rounded-[var(--radius-card)] border border-gold-light bg-gold-soft px-4 py-3 text-sm leading-6">
        <ShieldCheck size={18} className="mt-0.5 shrink-0 text-gold-dark" aria-hidden />
        <p>
          Checkout payments are created and verified on the server through Razorpay. This screen shows <strong>demo transactions</strong> — refunds recorded here are
          simulated until the admin backend is connected.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Collected (net of refunds)" value={formatCompactPrice(collected)} icon={<CreditCard size={18} />} hint={formatPrice(collected)} />
        <StatCard label="Successful payments" value={captured.length} icon={<CheckCircle2 size={18} />} tone="success" hint={`${successRate.toFixed(1)}% success rate`} />
        <StatCard label="Failed attempts" value={failed} icon={<AlertCircle size={18} />} tone="royal" hint="no order created" />
        <StatCard label="Refunded" value={formatCompactPrice(refunded)} icon={<RotateCcw size={18} />} tone="gold" hint={formatPrice(refunded)} />
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 pt-3">
          <Tabs<Tab>
            label="Payment status"
            value={tab}
            onChange={setTab}
            items={[
              { value: "all", label: "All", count: payments.length },
              { value: "paid", label: "Paid", count: payments.filter((p) => matchesTab(p, "paid")).length },
              { value: "failed", label: "Failed", count: failed },
              { value: "refunded", label: "Refunded", count: payments.filter((p) => matchesTab(p, "refunded")).length },
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
        <DataTable
          caption="Payments"
          rows={filtered}
          columns={columns}
          getRowId={(p) => p.id}
          resetKey={`${tab}|${q}|${method}`}
          initialSort={{ id: "pay", dir: "desc" }}
          empty={<TableEmpty icon={<CreditCard size={24} />} title="No payments found" />}
        />
      </div>

      <Dialog open={open !== null} onClose={() => setOpenId(null)} variant="right" size="lg" title="Payment details">
        {open && <PaymentDetail key={open.id} payment={open} onClose={() => setOpenId(null)} />}
      </Dialog>
    </>
  );
}
