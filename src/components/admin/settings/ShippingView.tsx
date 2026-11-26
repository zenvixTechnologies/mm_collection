"use client";

import Link from "next/link";
import { Globe2, Loader2, Lock, PackageCheck, Truck } from "lucide-react";
import { useState } from "react";
import type { AdminOrder, AdminPage, AdminSettingsView, CourierPartner, ShippingSettings } from "@/types/admin";
import { useAdminQuery } from "@/hooks/use-admin-query";
import { adminApi, errorMessage } from "@/lib/admin-api";
import { formatDate } from "@/lib/utils";
import { useAdminSession } from "@/store/admin-store";
import { toast } from "@/store/ui-store";
import { Badge, OrderStatusBadge } from "../ui/Badge";
import { Switch, TextField } from "../ui/FormControls";
import { PageHeader } from "../ui/PageHeader";
import { Panel } from "../ui/Panel";
import { LoadError } from "../ui/QueryState";

type OrderPage = AdminPage<AdminOrder> & { counts: Record<string, number> };

/** Loads the settings, then shows the editor (keyed so a saved copy resets the form). */
export function ShippingView() {
  const { data, status, error, reload, replace } = useAdminQuery<AdminSettingsView>("/settings");
  if (status === "loading") return <div className="skeleton h-96 rounded-2xl" role="status" aria-label="Loading" />;
  if (status === "error" || !data) {
    return (
      <div className="card">
        <LoadError title="Couldn't load shipping settings" message={error} onRetry={reload} />
      </div>
    );
  }
  return <ShippingEditor key={data.version} shipping={data.shipping} version={data.version} onSaved={replace} />;
}

function ShippingEditor({ shipping, version, onSaved }: { shipping: ShippingSettings; version: string; onSaved: (v: AdminSettingsView) => void }) {
  const canWrite = useAdminSession((s) => s.can("shipping:write"));
  const shipped = useAdminQuery<OrderPage>("/orders?status=Shipped&limit=50");
  const outForDelivery = useAdminQuery<OrderPage>("/orders?status=Out%20for%20Delivery&limit=50");
  const [estimate, setEstimate] = useState(shipping.deliveryEstimate);
  const [dispatch, setDispatch] = useState(shipping.dispatchTime);
  const [couriers, setCouriers] = useState<CourierPartner[]>(shipping.couriers);
  const [saving, setSaving] = useState(false);

  const inTransit = [...(shipped.data?.items ?? []), ...(outForDelivery.data?.items ?? [])];
  const counts = shipped.data?.counts ?? {};
  const readyToShip = (counts["Order Placed"] ?? 0) + (counts.Confirmed ?? 0) + (counts.Processing ?? 0);
  const dirty = estimate !== shipping.deliveryEstimate || dispatch !== shipping.dispatchTime || JSON.stringify(couriers) !== JSON.stringify(shipping.couriers);

  const save = async () => {
    if (couriers.every((c) => !c.enabled)) {
      toast.error("Keep at least one courier enabled.");
      return;
    }
    setSaving(true);
    try {
      const { data } = await adminApi<AdminSettingsView>("/settings/shipping", {
        method: "PATCH",
        body: { version, deliveryEstimate: estimate.trim(), dispatchTime: dispatch.trim(), couriers },
      });
      onSaved(data);
      toast.success("Shipping settings saved");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Shipping" }]}
        title="Shipping"
        description="How delivery is described to shoppers, which couriers you use, and what's on the way."
        actions={
          <button type="button" className="btn-primary btn-sm" disabled={!dirty || saving || !canWrite} onClick={() => void save()}>
            {saving && <Loader2 size={14} className="animate-spin" aria-hidden />} Save changes
          </button>
        }
      />

      <section className="relative mb-6 overflow-hidden rounded-[var(--radius-card)] bg-royal p-6 text-white sm:p-8" aria-labelledby="ship-charges">
        <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full border border-gold/20" aria-hidden />
        <div className="relative grid gap-6 lg:grid-cols-[1fr_360px] lg:items-center">
          <div>
            <p className="eyebrow text-gold-light">Shipping charges</p>
            <h2 id="ship-charges" className="mt-3 font-display text-4xl font-semibold text-white">
              {shipping.chargesNotice}
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/70">
              Shoppers see this wherever a shipping amount would appear: product pages, the bag, checkout and order summaries. No shipping amounts or rate rules are
              configured, and order totals don&apos;t include shipping.
            </p>
            <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs text-gold-light">
              <Lock size={13} aria-hidden /> Fixed for now — shipping rates are out of scope for this phase
            </p>
          </div>
          <div className="rounded-2xl bg-white p-5 text-ink shadow-[var(--shadow-pop)]" aria-label="How it looks at checkout">
            <p className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">Checkout preview</p>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Subtotal</dt>
                <dd>₹2,598</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Shipping</dt>
                <dd className="font-medium">{shipping.chargesNotice}</dd>
              </div>
              <div className="flex justify-between border-t border-line pt-2 font-semibold">
                <dt>Total</dt>
                <dd>₹2,598</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel
          title={
            <span className="inline-flex items-center gap-2">
              <Globe2 size={16} className="text-gold-dark" aria-hidden /> Delivery promise
            </span>
          }
          description="Shown in the announcement bar, product pages and the shipping policy."
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl bg-canvas px-4 py-3 text-sm">
              <span>
                Ships to <strong>{shipping.country}</strong> only
              </span>
              <Badge tone="success">Pan-India</Badge>
            </div>
            <TextField label="Delivery time" maxLength={120} value={estimate} disabled={!canWrite} onChange={(e) => setEstimate(e.target.value)} />
            <TextField label="Dispatch time" maxLength={120} value={dispatch} disabled={!canWrite} onChange={(e) => setDispatch(e.target.value)} />
            <Link href="/shipping-policy" target="_blank" className="inline-block text-[13px] font-semibold text-accent hover:underline">
              View shipping policy page ↗
            </Link>
          </div>
        </Panel>

        <Panel
          title={
            <span className="inline-flex items-center gap-2">
              <Truck size={16} className="text-gold-dark" aria-hidden /> Courier partners
            </span>
          }
          description="Enabled couriers appear when adding tracking to an order. Use {awb} where the tracking number goes."
        >
          <ul className="space-y-4">
            {couriers.map((c, i) => (
              <li key={c.id} className="rounded-xl border border-line p-4">
                <Switch
                  label={c.name}
                  description={c.enabled ? "Available for new shipments" : "Not used for new shipments"}
                  checked={c.enabled}
                  disabled={!canWrite}
                  onChange={(v) => setCouriers(couriers.map((x, j) => (j === i ? { ...x, enabled: v } : x)))}
                />
                <TextField
                  className="mt-3"
                  label="Tracking link"
                  value={c.trackingUrlTemplate}
                  maxLength={300}
                  disabled={!canWrite}
                  hint="https:// link containing {awb}"
                  inputClassName="font-mono text-xs"
                  onChange={(e) => setCouriers(couriers.map((x, j) => (j === i ? { ...x, trackingUrlTemplate: e.target.value } : x)))}
                />
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel
        className="mt-6"
        flush
        title={
          <span className="inline-flex items-center gap-2">
            <PackageCheck size={16} className="text-gold-dark" aria-hidden /> On the way
          </span>
        }
        description={`${inTransit.length} shipments in transit · ${readyToShip} orders waiting to be shipped`}
        action={
          <Link href="/mm-hub/orders?status=Processing" className="text-[13px] font-semibold text-accent hover:underline">
            Orders to ship
          </Link>
        }
      >
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Shipments in transit</caption>
            <thead>
              <tr className="border-b border-line bg-canvas/80 text-left text-[11.5px] tracking-[0.08em] text-muted uppercase">
                <th scope="col" className="px-5 py-3 font-semibold">Order</th>
                <th scope="col" className="px-4 py-3 font-semibold">Courier</th>
                <th scope="col" className="hidden px-4 py-3 font-semibold sm:table-cell">AWB</th>
                <th scope="col" className="hidden px-4 py-3 font-semibold md:table-cell">Destination</th>
                <th scope="col" className="hidden px-4 py-3 font-semibold lg:table-cell">Shipped</th>
                <th scope="col" className="px-5 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {inTransit.map((o) => (
                <tr key={o.id} className="hover:bg-canvas/70">
                  <td className="px-5 py-3">
                    <Link href={`/mm-hub/orders/${o.id}`} className="font-semibold hover:text-accent hover:underline">
                      {o.id}
                    </Link>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{o.tracking?.courier ?? <span className="text-danger">Missing</span>}</td>
                  <td className="hidden px-4 py-3 font-mono text-xs sm:table-cell">{o.tracking?.awb ?? "—"}</td>
                  <td className="hidden px-4 py-3 whitespace-nowrap md:table-cell">
                    {o.address.city}, {o.address.state}
                  </td>
                  <td className="hidden px-4 py-3 whitespace-nowrap text-muted lg:table-cell">{o.tracking?.shippedAt ? formatDate(o.tracking.shippedAt) : "—"}</td>
                  <td className="px-5 py-3">
                    <OrderStatusBadge status={o.status} />
                  </td>
                </tr>
              ))}
              {(shipped.status === "loading" || outForDelivery.status === "loading") && !inTransit.length && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-muted">
                    Loading…
                  </td>
                </tr>
              )}
              {shipped.status === "ready" && outForDelivery.status === "ready" && !inTransit.length && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-muted">
                    Nothing in transit right now.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
