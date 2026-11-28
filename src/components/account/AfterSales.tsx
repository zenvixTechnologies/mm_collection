"use client";

import Link from "next/link";
import { Loader2, RotateCcw, XCircle } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { AfterSalesView, CustomerReturnRequest, RefundSummary, ReturnLine, StoreOrder } from "@/types";
import { CANCEL_REASONS, CANCEL_REASON_KEYS, RETURN_REASONS, cancelAction, type CancelReason, type ReturnReason } from "@/lib/after-sales";
import { ApiError, errorMessage } from "@/lib/api-client";
import { customerApi } from "@/lib/customer-api";
import { cn, formatDate, formatPrice } from "@/lib/utils";
import { useAuthStore } from "@/store/auth-store";
import { toast } from "@/store/ui-store";
import { DamagedItemsPolicy, ReturnPolicyContent, ReturnWindowAndEligibility } from "@/components/layout/ReturnPolicyContent";
import { Dialog } from "@/components/ui/Dialog";

/** How often an open order page checks whether the order has moved on (e.g. been shipped). */
const POLL_MS = 15_000;

export const SHIPPED_MESSAGE = "This order has shipped, so it can no longer be cancelled.";

export function refundMessage(refund: RefundSummary) {
  const done = refund.refunded > 0 ? `${formatPrice(refund.refunded)} has been refunded. ` : "";
  switch (refund.state) {
    case "refunded":
      return `Refunded: ${formatPrice(refund.refunded)} has been refunded to your original payment method.`;
    case "processing":
      return `${done}Refund processing: ${formatPrice(refund.processing)} is on its way but not complete yet.`;
    case "partial":
      return `Partly refunded: ${formatPrice(refund.refunded)} has been refunded.`;
    case "pending":
      return "Refund pending: your payment has not been refunded yet. Our team handles refunds separately, and this page shows their progress.";
    default:
      return null;
  }
}

/** Cancel (before shipping) or return (after delivery), on the customer's own order page. */
export function AfterSales({ order, onOrderChanged }: { order: StoreOrder; onOrderChanged: () => void }) {
  const authStatus = useAuthStore((s) => s.status);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const [dialog, setDialog] = useState<"cancel" | "return" | null>(null);

  const key = `${userId}:${order.id}`;
  const [loaded, setLoaded] = useState<{ key: string; view: AfterSalesView | null; failure: "not-yours" | "error" | null } | null>(null);
  useEffect(() => {
    if (authStatus !== "authenticated" || !userId) return;
    const ctrl = new AbortController();
    customerApi<AfterSalesView>(`/orders/${encodeURIComponent(order.id)}/after-sales`, { signal: ctrl.signal })
      .then((r) => setLoaded({ key, view: r.data, failure: null }))
      .catch((err: unknown) => {
        if ((err as Error).name === "AbortError") return;
        const notYours = err instanceof ApiError && err.status === 404;
        // A failed background check keeps what's on screen.
        setLoaded((last) => (!notYours && last?.key === key && last.view ? last : { key, view: null, failure: notYours ? "not-yours" : "error" }));
      });
    return () => ctrl.abort();
  }, [authStatus, userId, order.id, order.status, key, version]);
  const current = loaded?.key === key ? loaded : null;
  const view = current?.view ?? null;

  // The server's status is newer than the page's: reload the order so both agree.
  const serverStatus = view?.orderStatus;
  useEffect(() => {
    if (serverStatus && serverStatus !== order.status) onOrderChanged();
  }, [serverStatus]); // eslint-disable-line react-hooks/exhaustive-deps -- only when the server's answer changes

  // While the order can still change under the customer, check again now and then and on return to the tab.
  const watching = cancelAction(order.status) === "on";
  useEffect(() => {
    if (!watching) return;
    const check = () => document.visibilityState === "visible" && refresh();
    const timer = window.setInterval(check, POLL_MS);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [watching, refresh]);

  const status = view && view.orderStatus !== order.status ? view.orderStatus : order.status;
  const action = cancelAction(status);
  const delivered = status === "Delivered";
  const cancelled = status === "Cancelled";
  if (!delivered && !cancelled && action === "hidden") return null; // unpaid, failed or expired

  const guest = authStatus === "anonymous" || current?.failure === "not-yours";
  const canCancel = !!view && view.cancel === "on" && action === "on";
  const canReturn = !!view && view.lines.some((l) => l.returnableQuantity > 0);
  const returnBlocked = view && delivered && !canReturn ? [...new Set(view.lines.map((l) => l.message).filter(Boolean))] : [];
  if (cancelled && guest) return null;

  const done = (next: AfterSalesView, message: string) => {
    setLoaded({ key, view: next, failure: null });
    setDialog(null);
    toast.success(message);
    onOrderChanged();
  };

  return (
    <section className="rounded-2xl border border-line p-5 sm:p-6" aria-labelledby="after-sales-heading">
      <h2 id="after-sales-heading" className="mb-3 font-semibold">
        {cancelled ? "Cancellation" : delivered ? "Returns" : "Cancel order"}
      </h2>

      {guest ? (
        <p className="text-sm text-muted">
          Online cancellation and returns are available for orders placed while signed in. For this order,{" "}
          <Link href="/contact" className="font-semibold text-ink underline">
            contact us
          </Link>{" "}
          with your order ID.
        </p>
      ) : current?.failure === "error" && !view ? (
        <p className="text-sm text-muted" role="alert">
          We couldn&apos;t load your options.{" "}
          <button type="button" onClick={refresh} className="font-semibold text-ink underline">
            Try again
          </button>
        </p>
      ) : cancelled ? (
        <div className="space-y-2 text-sm">
          <p>
            This order is <strong>Cancelled</strong>.
          </p>
          {view?.cancellation && (
            <dl className="space-y-1 text-muted">
              <div>
                <dt className="inline font-medium text-ink">Your reason: </dt>
                <dd className="inline break-words">
                  {view.cancellation.reason}
                  {view.cancellation.otherReason && ` — ${view.cancellation.otherReason}`}
                </dd>
              </div>
              {view.cancellation.details && (
                <div>
                  <dt className="inline font-medium text-ink">Details: </dt>
                  <dd className="inline break-words whitespace-pre-line">{view.cancellation.details}</dd>
                </div>
              )}
              <div>
                <dt className="inline font-medium text-ink">Requested: </dt>
                <dd className="inline">{formatDate(view.cancellation.requestedAt, true)}</dd>
              </div>
            </dl>
          )}
          {view?.refund && <p className="rounded-xl bg-canvas px-4 py-3 text-[13px]">{refundMessage(view.refund)}</p>}
        </div>
      ) : delivered ? (
        <>
          {view?.returnWindowEndsAt && canReturn && <p className="mb-3 text-sm text-muted">You can request a return until {formatDate(view.returnWindowEndsAt, true)}.</p>}
          <button type="button" onClick={() => setDialog("return")} disabled={!canReturn} className="btn-outline min-h-10 px-6 text-[13px] disabled:cursor-not-allowed disabled:opacity-50">
            <RotateCcw size={15} aria-hidden /> Return
          </button>
          {returnBlocked.map((m) => (
            <p key={m} className="mt-2 text-xs leading-5 text-muted">
              {m}
            </p>
          ))}
          <p className="mt-2 text-xs text-muted">
            <Link href="/return-policy" target="_blank" className="underline">
              Return &amp; Refund Policy
            </Link>
          </p>
          {view?.refund && <p className="mt-3 rounded-xl bg-canvas px-4 py-3 text-[13px]">{refundMessage(view.refund)}</p>}
          {view && view.requests.length > 0 && <ReturnRequests requests={view.requests} />}
        </>
      ) : (
        <>
          <button type="button" onClick={() => setDialog("cancel")} disabled={!canCancel} className="btn-outline min-h-10 px-6 text-[13px] disabled:cursor-not-allowed disabled:opacity-50">
            <XCircle size={15} aria-hidden /> Cancel order
          </button>
          <p className="mt-2 text-xs leading-5 text-muted">{action === "off" ? SHIPPED_MESSAGE : "You can cancel until the order is shipped."}</p>
        </>
      )}

      {dialog === "cancel" && canCancel && <CancelDialog orderId={order.id} onClose={() => setDialog(null)} onDone={(v) => done(v, "Your order has been cancelled.")} onRefused={refresh} />}
      {/* Stays open if a cancellation is refused because the order shipped meanwhile: it shows why. */}
      {dialog === "cancel" && !canCancel && view && (
        <Dialog open onClose={() => setDialog(null)} title="Cancel Order" variant="bottom-sheet">
          <p className="p-5 text-sm" role="alert">
            {action === "off" ? SHIPPED_MESSAGE : "This order can no longer be cancelled."}
          </p>
        </Dialog>
      )}
      {dialog === "return" && view && <ReturnDialog orderId={order.id} lines={view.lines} onClose={() => setDialog(null)} onDone={(v) => done(v, "Return request sent.")} onRefused={refresh} />}
    </section>
  );
}

function ReturnRequests({ requests }: { requests: CustomerReturnRequest[] }) {
  return (
    <div className="mt-5 border-t border-line pt-4">
      <h3 className="mb-3 text-sm font-semibold">Your return requests</h3>
      <ul className="space-y-3">
        {requests.map((r) => (
          <li key={r.id} className="rounded-xl bg-canvas px-4 py-3 text-[13px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                {r.name}
                <span className="font-normal text-muted">{[r.size && ` · Size ${r.size}`, r.color && ` · ${r.color}`, ` · Qty ${r.quantity}`].filter(Boolean).join("")}</span>
              </p>
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-semibold",
                  r.status === "completed" ? "bg-success-soft text-success" : r.status === "rejected" ? "bg-danger-soft text-danger" : "bg-sand text-ink",
                )}
              >
                {r.statusLabel}
              </span>
            </div>
            <p className="mt-1.5 break-words text-muted">
              <span className="font-medium text-ink">Reason: </span>
              {r.reason}
              {r.explanation && ` — ${r.explanation}`}
            </p>
            {r.comments && <p className="mt-1 break-words whitespace-pre-line text-muted">{r.comments}</p>}
            <ol className="mt-2 space-y-0.5 text-xs text-muted" aria-label={`History of the return request for ${r.name}`}>
              {r.history.map((h) => (
                <li key={`${h.status}-${h.at}`}>
                  {h.status} · {formatDate(h.at, true)}
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface DialogProps {
  orderId: string;
  onClose: () => void;
  onDone: (view: AfterSalesView) => void;
  /** The server refused: the order has changed, so reload what's allowed. */
  onRefused: () => void;
}

function useSubmit(path: string, { onDone, onRefused }: Pick<DialogProps, "onDone" | "onRefused">) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const send = async (body: unknown) => {
    setSaving(true);
    setError("");
    try {
      onDone((await customerApi<AfterSalesView>(path, { method: "POST", body })).data);
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && (err.status === 403 || err.status === 409)) onRefused();
      setSaving(false);
    }
  };
  return { saving, error, setError, send };
}

const labelCls = "flex items-start gap-3 rounded-xl border border-line px-3 py-2.5 text-sm has-checked:border-ink has-checked:bg-canvas";

export function CancelDialog({ orderId, onClose, onDone, onRefused }: DialogProps) {
  const [reason, setReason] = useState<CancelReason | "">("");
  const [otherReason, setOtherReason] = useState("");
  const [details, setDetails] = useState("");
  const [confirm, setConfirm] = useState(false);
  const { saving, error, setError, send } = useSubmit(`/orders/${encodeURIComponent(orderId)}/cancel`, { onDone, onRefused });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!reason) return setError("Choose why you're cancelling.");
    if (reason === "other" && otherReason.trim().length < 3) return setError("Please tell us your reason.");
    if (!confirm) return setError("Please confirm that you want to cancel this order.");
    void send({ reason, otherReason: reason === "other" ? otherReason.trim() : "", details: details.trim(), confirm: true });
  };

  return (
    <Dialog open onClose={onClose} title="Cancel Order" variant="bottom-sheet">
      <form onSubmit={submit} noValidate className="space-y-4 p-5">
        <p className="text-sm">Please tell us why you want to cancel this order.</p>
        <fieldset className="space-y-2">
          <legend className="sr-only">Cancellation reason (required)</legend>
          {CANCEL_REASON_KEYS.map((key) => (
            <label key={key} className={labelCls}>
              <input type="radio" name="cancel-reason" value={key} checked={reason === key} onChange={() => setReason(key)} className="mt-0.5 h-4 w-4 accent-ink" />
              {CANCEL_REASONS[key]}
            </label>
          ))}
        </fieldset>
        {reason === "other" && (
          <div>
            <label htmlFor="cancel-other" className="field-label">
              Your reason (required)
            </label>
            <input id="cancel-other" className="field-input" maxLength={500} value={otherReason} onChange={(e) => setOtherReason(e.target.value)} />
          </div>
        )}
        <div>
          <label htmlFor="cancel-details" className="field-label">
            Additional details (optional)
          </label>
          <textarea id="cancel-details" rows={3} maxLength={1000} className="field-input h-auto py-3" value={details} onChange={(e) => setDetails(e.target.value)} />
        </div>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5 h-4 w-4 accent-ink" />
          Yes, I want to cancel this order. This can&apos;t be undone.
        </label>
        <p className="text-xs leading-5 text-muted">Refunds are handled separately by our team after cancellation. Your order page shows their progress.</p>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="btn-ghost min-h-11 px-5">
            Keep order
          </button>
          <button type="submit" disabled={saving || !reason || !confirm} className="btn-primary min-h-11 px-6 disabled:opacity-60">
            {saving && <Loader2 size={16} className="animate-spin" />} Cancel order
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function ReturnDialog({ orderId, lines, onClose, onDone, onRefused }: DialogProps & { lines: ReturnLine[] }) {
  const open = lines.filter((l) => l.returnableQuantity > 0);
  const [itemId, setItemId] = useState(open.length === 1 ? open[0].itemId : "");
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState<ReturnReason | "">("");
  const [explanation, setExplanation] = useState("");
  const [comments, setComments] = useState("");
  const [confirm, setConfirm] = useState(false);
  const { saving, error, setError, send } = useSubmit(`/orders/${encodeURIComponent(orderId)}/returns`, { onDone, onRefused });
  const line = open.find((l) => l.itemId === itemId);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!line) return setError("Choose the item you're returning.");
    if (!reason) return setError("Choose a return reason.");
    if (reason === "other" && explanation.trim().length < 3) return setError("Please explain your reason.");
    if (!confirm) return setError("Please confirm before submitting.");
    void send({ itemId: line.itemId, quantity: Math.min(quantity, line.returnableQuantity), reason, explanation: explanation.trim(), comments: comments.trim(), confirm: true });
  };

  return (
    <Dialog open onClose={onClose} title="Return Request" variant="bottom-sheet">
      <form onSubmit={submit} noValidate className="space-y-4 p-5">
        <div className="rounded-xl bg-canvas px-4 py-3">
          <p className="text-sm font-semibold">Return Policy</p>
          <div className="prose-policy mt-1 max-h-56 overflow-y-auto text-[13px] [&_h2]:!mt-3 [&_h2]:!text-sm" tabIndex={0} aria-label="Return policy summary">
            <ReturnWindowAndEligibility />
            <DamagedItemsPolicy />
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer text-[13px] font-semibold underline">Read the complete Return Policy</summary>
            <div className="prose-policy mt-2 max-h-72 overflow-y-auto text-[13px] [&_h2]:!mt-3 [&_h2]:!text-sm">
              <ReturnPolicyContent />
            </div>
          </details>
          <Link href="/return-policy" target="_blank" className="mt-2 inline-block text-xs underline">
            Open the policy page ↗
          </Link>
        </div>

        <fieldset className="space-y-2">
          <legend className="field-label">Item to return</legend>
          {lines.map((l) => (
            <label key={l.itemId} className={cn(labelCls, !l.returnableQuantity && "opacity-60")}>
              <input
                type="radio"
                name="return-item"
                checked={itemId === l.itemId}
                disabled={!l.returnableQuantity}
                onChange={() => {
                  setItemId(l.itemId);
                  setQuantity(1);
                  setReason("");
                }}
                className="mt-0.5 h-4 w-4 accent-ink"
              />
              <span>
                {l.name}
                <span className="block text-xs text-muted">{[l.size && `Size ${l.size}`, l.color, `Bought ${l.quantity}`].filter(Boolean).join(" · ")}</span>
                {l.message && <span className="mt-1 block text-xs text-muted">{l.message}</span>}
              </span>
            </label>
          ))}
        </fieldset>

        {line && line.returnableQuantity > 1 && (
          <div>
            <label htmlFor="return-quantity" className="field-label">
              Quantity
            </label>
            <select id="return-quantity" className="field-input" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))}>
              {Array.from({ length: line.returnableQuantity }, (_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label htmlFor="return-reason" className="field-label">
            Return reason (required)
          </label>
          <select id="return-reason" className="field-input" value={reason} disabled={!line} onChange={(e) => setReason(e.target.value as ReturnReason)}>
            <option value="">{line ? "Choose a reason" : "Choose an item first"}</option>
            {line?.reasons.map((key) => (
              <option key={key} value={key}>
                {RETURN_REASONS[key]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="return-explanation" className="field-label">
            Explanation ({reason === "other" ? "required" : "optional"})
          </label>
          <textarea id="return-explanation" rows={2} maxLength={1000} className="field-input h-auto py-3" value={explanation} onChange={(e) => setExplanation(e.target.value)} />
        </div>
        <div>
          <label htmlFor="return-comments" className="field-label">
            Other comments (optional)
          </label>
          <textarea id="return-comments" rows={2} maxLength={1000} className="field-input h-auto py-3" value={comments} onChange={(e) => setComments(e.target.value)} />
        </div>
        <p className="text-xs leading-5 text-muted">For damaged or wrong items we may ask you for photos or an unboxing video. Submitting a request doesn&apos;t guarantee approval or a refund.</p>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5 h-4 w-4 accent-ink" />
          I&apos;ve read the Return Policy and want to submit this return request.
        </label>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="btn-ghost min-h-11 px-5">
            Close
          </button>
          <button type="submit" disabled={saving || !line || !reason || !confirm} className="btn-primary min-h-11 px-6 disabled:opacity-60">
            {saving && <Loader2 size={16} className="animate-spin" />} Submit return request
          </button>
        </div>
      </form>
    </Dialog>
  );
}
