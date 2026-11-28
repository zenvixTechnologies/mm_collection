"use client";

import Link from "next/link";
import { Loader2, PackageX, Undo2 } from "lucide-react";
import { useState } from "react";
import type { AdminCancellation, AdminPage, AdminReturnRequest } from "@/types/admin";
import type { RefundSummary } from "@/types";
import { useAdminQuery, withQuery } from "@/hooks/use-admin-query";
import { RETURN_STATUSES, RETURN_STATUS_KEYS, type ReturnStatus } from "@/lib/after-sales";
import { adminApi, AdminApiError, errorMessage } from "@/lib/admin-api";
import { formatDate, formatPrice } from "@/lib/utils";
import { toast } from "@/store/ui-store";
import { Dialog } from "@/components/ui/Dialog";
import { Badge, type BadgeTone } from "../ui/Badge";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { DataTable, TableEmpty, type Column } from "../ui/DataTable";
import { TextAreaField } from "../ui/FormControls";
import { PageHeader } from "../ui/PageHeader";
import { LoadError, TableSkeleton } from "../ui/QueryState";
import { FilterSelect, Tabs, Toolbar } from "../ui/Toolbar";

const PAGE_SIZE = 20;
const TONE: Record<ReturnStatus, BadgeTone> = { requested: "gold", approved: "neutral", rejected: "danger", processing: "warning", completed: "success" };
const REFUND_LABEL: Record<RefundSummary["state"], string> = { none: "No payment record", pending: "Not refunded", processing: "Refund processing", partial: "Part refunded", refunded: "Refunded" };

function RefundNote({ refund, order }: { refund: RefundSummary; order: string }) {
  return (
    <span className="whitespace-nowrap">
      {REFUND_LABEL[refund.state]}
      {refund.refunded > 0 && ` · ${formatPrice(refund.refunded)}`}{" "}
      <Link href={`/mm-hub/payments?q=${order}`} className="text-xs font-semibold text-accent hover:underline">
        Payments
      </Link>
    </span>
  );
}

const OrderLink = ({ id }: { id: string }) => (
  <Link href={`/mm-hub/orders/${id}`} className="font-semibold hover:text-accent hover:underline">
    {id}
  </Link>
);

/** One return request: what the customer said, its history, internal notes and the next steps. */
function ReturnDetail({ item, onClose, onChanged }: { item: AdminReturnRequest; onClose: () => void; onChanged: (r: AdminReturnRequest) => void }) {
  const [note, setNote] = useState("");
  const [target, setTarget] = useState<ReturnStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (request: () => Promise<{ data: AdminReturnRequest }>, success: string) => {
    setBusy(true);
    try {
      onChanged((await request()).data);
      setNote("");
      toast.success(success);
    } catch (err) {
      toast.error(errorMessage(err));
      if (err instanceof AdminApiError && err.status === 409) onClose();
    } finally {
      setBusy(false);
    }
  };

  const facts: [string, React.ReactNode][] = [
    ["Order", <OrderLink key="o" id={item.orderNumber} />],
    ["Customer", `${item.customerName} · ${item.customerEmail}`],
    ["Product", `${item.name}${item.size ? ` · ${item.size}` : ""}${item.color ? ` · ${item.color}` : ""}`],
    ["SKU", item.sku],
    ["Quantity", `${item.quantity} × ${formatPrice(item.unitPrice)} (before any coupon)`],
    ["Reason", item.reason],
    ["Explanation", item.explanation || "—"],
    ["Comments", item.comments || "—"],
    ["Delivered", formatDate(item.deliveredAt, true)],
    ["Requested", formatDate(item.requestedAt, true)],
    ...(item.withinClaimWindow === null ? [] : ([["48-hour damage/wrong item rule", item.withinClaimWindow ? "Reported within 48 hours" : "Reported after 48 hours"]] as [string, string][])),
    ...(item.refund ? ([["Order refund", <RefundNote key="r" refund={item.refund} order={item.orderNumber} />]] as [string, React.ReactNode][]) : []),
  ];

  return (
    <Dialog open onClose={onClose} title={`Return · ${item.orderNumber}`} variant="right" size="lg">
      <div className="space-y-5 p-5 text-sm">
        <Badge tone={TONE[item.status]}>{item.statusLabel}</Badge>
        <dl className="space-y-2">
          {facts.map(([label, value]) => (
            <div key={label} className="grid gap-1 sm:grid-cols-[150px_1fr]">
              <dt className="text-muted">{label}</dt>
              <dd className="break-words whitespace-pre-line">{value}</dd>
            </div>
          ))}
        </dl>

        <div>
          <h3 className="mb-1.5 font-semibold">History</h3>
          <ol className="space-y-1 text-[13px] text-muted" aria-label="Request history">
            {item.history.map((h) => (
              <li key={`${h.status}-${h.at}`}>
                <strong className="text-ink">{h.status}</strong> · {h.by} · {formatDate(h.at, true)}
              </li>
            ))}
          </ol>
        </div>

        <div>
          <h3 className="mb-1.5 font-semibold">Internal notes</h3>
          {item.adminNotes.length > 0 ? (
            <ul className="mb-3 space-y-2">
              {item.adminNotes.map((n) => (
                <li key={n.id} className="rounded-xl bg-canvas px-3 py-2">
                  <p className="break-words whitespace-pre-line">{n.text}</p>
                  <p className="text-xs text-muted">
                    {n.author} · {formatDate(n.createdAt, true)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-muted">No notes yet.</p>
          )}
          <TextAreaField label="Internal note" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} hint="Only the store team sees this. It's saved with a status change, or on its own." />
          <button
            type="button"
            className="btn-outline btn-sm mt-2"
            disabled={busy || !note.trim()}
            onClick={() => void run(() => adminApi<AdminReturnRequest>(`/returns/${item.id}/notes`, { method: "POST", body: { text: note.trim() } }), "Note added")}
          >
            Add note
          </button>
        </div>

        {item.allowedStatuses.length > 0 ? (
          <div className="border-t border-line pt-4">
            <h3 className="mb-2 font-semibold">Update status</h3>
            <div className="flex flex-wrap gap-2">
              {item.allowedStatuses.map((s) => (
                <button key={s} type="button" disabled={busy} onClick={() => setTarget(s)} className={s === "rejected" ? "btn-ghost btn-sm text-danger hover:bg-danger-soft" : "btn-primary btn-sm"}>
                  {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
                  {s === "approved" ? "Approve return" : s === "rejected" ? "Reject return" : `Mark as ${RETURN_STATUSES[s]}`}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs leading-5 text-muted">
              Changing the status never refunds money or changes stock. Refund from <strong className="text-ink">Payments</strong>, and book received units back in <strong className="text-ink">Inventory</strong>.
            </p>
          </div>
        ) : (
          <p className="border-t border-line pt-4 text-muted">This request is closed.</p>
        )}
      </div>

      <ConfirmDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        title={target ? `Move to ${RETURN_STATUSES[target]}?` : ""}
        description="The customer sees the new status on their order page. Status moves can't be undone. No refund is issued and stock doesn't change."
        confirmLabel={target ? RETURN_STATUSES[target] : "Confirm"}
        destructive={target === "rejected"}
        onConfirm={() => {
          const status = target;
          if (status) void run(() => adminApi<AdminReturnRequest>(`/returns/${item.id}`, { method: "PATCH", body: { status, note: note.trim() } }), RETURN_STATUSES[status]);
        }}
      />
    </Dialog>
  );
}

function Returns() {
  const [status, setStatus] = useState<ReturnStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const query = useAdminQuery<AdminPage<AdminReturnRequest>>(withQuery("/returns", { status: status === "all" ? undefined : status, page, limit: PAGE_SIZE }));
  const rows = query.data?.items ?? [];
  // Keeps the panel showing the saved request even if it has left the current filter.
  const [saved, setSaved] = useState<AdminReturnRequest | null>(null);
  const open = openId ? (saved?.id === openId ? saved : rows.find((r) => r.id === openId)) : undefined;

  const columns: Column<AdminReturnRequest>[] = [
    { id: "order", header: "Order", cell: (r) => <OrderLink id={r.orderNumber} /> },
    {
      id: "product",
      header: "Product",
      cell: (r) => (
        <div className="min-w-[150px]">
          <p className="font-medium">{r.name}</p>
          <p className="text-xs text-muted">{[r.size, r.color, `Qty ${r.quantity}`].filter(Boolean).join(" · ")}</p>
        </div>
      ),
    },
    { id: "customer", header: "Customer", hideBelow: "lg", cell: (r) => r.customerName },
    {
      id: "reason",
      header: "Reason",
      hideBelow: "md",
      cell: (r) => (
        <div className="max-w-xs">
          <p>{r.reason}</p>
          {(r.explanation || r.comments) && <p className="line-clamp-2 text-xs break-words text-muted">{[r.explanation, r.comments].filter(Boolean).join(" · ")}</p>}
        </div>
      ),
    },
    { id: "date", header: "Requested", hideBelow: "xl", cell: (r) => <span className="whitespace-nowrap text-muted">{formatDate(r.requestedAt, true)}</span> },
    { id: "status", header: "Status", cell: (r) => <Badge tone={TONE[r.status]}>{r.statusLabel}</Badge> },
    {
      id: "open",
      header: <span className="sr-only">Open</span>,
      align: "right",
      cell: (r) => (
        <button
          type="button"
          className="btn-outline btn-sm"
          onClick={() => {
            setSaved(null);
            setOpenId(r.id);
          }}
          aria-label={`Review return of ${r.name} on order ${r.orderNumber}`}
        >
          Review
        </button>
      ),
    },
  ];

  return (
    <>
      <Toolbar className="p-4">
        <FilterSelect
          label="Return status"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={[{ value: "all" as const, label: "All statuses" }, ...RETURN_STATUS_KEYS.map((s) => ({ value: s, label: RETURN_STATUSES[s] }))]}
        />
        <p className="text-[13px] text-muted sm:ml-auto">
          {query.data?.total ?? 0} request{query.data?.total === 1 ? "" : "s"}
        </p>
      </Toolbar>
      {query.status === "loading" ? (
        <TableSkeleton />
      ) : query.status === "error" ? (
        <LoadError title="Couldn't load return requests" message={query.error} onRetry={query.reload} />
      ) : (
        <DataTable
          caption="Return requests"
          rows={rows}
          columns={columns}
          getRowId={(r) => r.id}
          server={{ page, totalPages: query.data?.totalPages ?? 1, total: query.data?.total ?? 0, limit: PAGE_SIZE, onPageChange: setPage, loading: query.refreshing }}
          empty={<TableEmpty icon={<Undo2 size={24} />} title="No return requests" description="Requests appear here when customers ask to return a delivered item." />}
        />
      )}
      {open && (
        <ReturnDetail
          item={open}
          onClose={() => {
            setOpenId(null);
            query.reload();
          }}
          onChanged={(r) => {
            setSaved(r);
            query.reload();
          }}
        />
      )}
    </>
  );
}

function Cancellations() {
  const [page, setPage] = useState(1);
  const query = useAdminQuery<AdminPage<AdminCancellation>>(withQuery("/cancellations", { page, limit: PAGE_SIZE }));
  const columns: Column<AdminCancellation>[] = [
    { id: "order", header: "Order", cell: (c) => <OrderLink id={c.id} /> },
    {
      id: "products",
      header: "Products",
      hideBelow: "md",
      cell: (c) => (
        <ul className="min-w-[150px]">
          {c.products.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
          <li className="text-xs text-muted">{c.customerName}</li>
        </ul>
      ),
    },
    {
      id: "reason",
      header: "Reason",
      cell: (c) => (
        <div className="min-w-[180px] max-w-md break-words">
          <p className="font-medium">
            {c.reason}
            {c.otherReason && ` — ${c.otherReason}`}
          </p>
          {c.details && <p className="text-xs whitespace-pre-line text-muted">{c.details}</p>}
        </div>
      ),
    },
    {
      id: "when",
      header: "Cancelled",
      hideBelow: "lg",
      cell: (c) => (
        <div className="whitespace-nowrap text-muted">
          {formatDate(c.requestedAt, true)}
          <p className="text-xs">while {c.statusAtRequest}</p>
        </div>
      ),
    },
    { id: "refund", header: "Refund", cell: (c) => <RefundNote refund={c.refund} order={c.id} /> },
  ];
  if (query.status === "loading") return <TableSkeleton />;
  if (query.status === "error") return <LoadError title="Couldn't load cancellations" message={query.error} onRetry={query.reload} />;
  return (
    <DataTable
      caption="Orders cancelled by customers"
      rows={query.data?.items ?? []}
      columns={columns}
      getRowId={(c) => c.id}
      server={{ page, totalPages: query.data?.totalPages ?? 1, total: query.data?.total ?? 0, limit: PAGE_SIZE, onPageChange: setPage, loading: query.refreshing }}
      empty={<TableEmpty icon={<PackageX size={24} />} title="No cancellations" description="Orders that customers cancel appear here with their reason." />}
    />
  );
}

export function ReturnsView() {
  const [tab, setTab] = useState<"returns" | "cancellations">("returns");
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Returns" }]} title="Returns & Cancellations" description="Review return requests, and see why customers cancelled." />
      <div className="card overflow-hidden">
        <div className="px-4 pt-3">
          <Tabs
            label="Request type"
            value={tab}
            onChange={setTab}
            items={[
              { value: "returns", label: "Return requests" },
              { value: "cancellations", label: "Customer cancellations" },
            ]}
          />
        </div>
        {tab === "returns" ? <Returns /> : <Cancellations />}
      </div>
    </>
  );
}
