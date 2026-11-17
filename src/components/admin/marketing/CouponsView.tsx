"use client";

import { useSearchParams } from "next/navigation";
import { BadgePercent, Copy, Megaphone, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type { CouponType } from "@/types";
import type { AdminCoupon, AdminOffer } from "@/types/admin";
import { MOCK_NOW, istDateKey } from "@/data/admin/mock-utils";
import { formatDate, formatPrice } from "@/lib/utils";
import { uid, useAdminStore } from "@/store/admin-store";
import { toast } from "@/store/ui-store";
import { Dialog } from "@/components/ui/Dialog";
import { Badge, type BadgeTone } from "../ui/Badge";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { DataTable, TableEmpty, type Column } from "../ui/DataTable";
import { SelectField, Switch, TextField } from "../ui/FormControls";
import { PageHeader } from "../ui/PageHeader";
import { Tabs } from "../ui/Toolbar";

/* ---------- helpers ---------- */

type CouponState = "Live" | "Scheduled" | "Expired" | "Used up" | "Disabled";
const STATE_TONE: Record<CouponState, BadgeTone> = { Live: "success", Scheduled: "gold", Expired: "muted", "Used up": "muted", Disabled: "neutral" };

export function couponState(c: AdminCoupon, now = MOCK_NOW.getTime()): CouponState {
  if (!c.active) return "Disabled";
  if (new Date(c.startsAt).getTime() > now) return "Scheduled";
  if (c.endsAt && new Date(c.endsAt).getTime() < now) return "Expired";
  if (c.usageLimit !== null && c.usageCount >= c.usageLimit) return "Used up";
  return "Live";
}

export function describeCoupon(c: Pick<AdminCoupon, "type" | "value" | "minOrder" | "maxDiscount">) {
  const off = c.type === "percent" ? `${c.value}% off` : `Flat ${formatPrice(c.value)} off`;
  const min = c.minOrder > 0 ? ` on orders above ${formatPrice(c.minOrder)}` : " your order";
  const cap = c.type === "percent" && c.maxDiscount ? ` (up to ${formatPrice(c.maxDiscount)})` : "";
  return `${off}${min}${cap}`;
}

const toDateInput = (iso: string | null) => (iso ? istDateKey(iso) : "");
const fromDateInput = (d: string, endOfDay = false) => (d ? new Date(`${d}T${endOfDay ? "23:59:00" : "00:00:00"}+05:30`).toISOString() : null);

/* ---------- coupon form ---------- */

function CouponForm({ coupon, onDone }: { coupon: AdminCoupon | null; onDone: () => void }) {
  const coupons = useAdminStore((s) => s.coupons);
  const save = useAdminStore((s) => s.saveCoupon);
  const [c, setC] = useState<AdminCoupon>(
    () =>
      coupon ?? {
        id: uid("cp"),
        code: "",
        type: "percent",
        value: 10,
        minOrder: 0,
        maxDiscount: 500,
        description: "",
        active: true,
        usageCount: 0,
        usageLimit: null,
        startsAt: MOCK_NOW.toISOString(),
        endsAt: null,
      },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof AdminCoupon>(k: K, v: AdminCoupon[K]) => setC((p) => ({ ...p, [k]: v }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const code = c.code.trim().toUpperCase();
    const errs: Record<string, string> = {};
    if (!/^[A-Z0-9]{3,20}$/.test(code)) errs.code = "Use 3–20 letters or numbers, no spaces.";
    else if (coupons.some((x) => x.code === code && x.id !== c.id)) errs.code = "A coupon with this code already exists.";
    if (!(c.value > 0)) errs.value = "Enter a discount.";
    else if (c.type === "percent" && c.value > 90) errs.value = "Percentage discounts can be at most 90%.";
    if (c.endsAt && new Date(c.endsAt) < new Date(c.startsAt)) errs.endsAt = "End date must be after the start date.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const final = { ...c, code, maxDiscount: c.type === "percent" ? c.maxDiscount || undefined : undefined };
    save({ ...final, description: c.description.trim() || describeCoupon(final) });
    toast.success(coupon ? `Coupon ${code} updated` : `Coupon ${code} created`);
    onDone();
  };

  return (
    <form onSubmit={submit} noValidate>
      <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
        <TextField
          className="sm:col-span-2"
          label="Coupon code"
          required
          value={c.code}
          error={errors.code}
          onChange={(e) => set("code", e.target.value.toUpperCase().replace(/\s/g, ""))}
          inputClassName="font-mono tracking-wider uppercase"
          placeholder="e.g. DIWALI15"
          data-autofocus
        />
        <SelectField
          label="Discount type"
          value={c.type}
          onChange={(e) => set("type", e.target.value as CouponType)}
          options={[
            { value: "percent", label: "Percentage (%)" },
            { value: "flat", label: "Flat amount (₹)" },
          ]}
        />
        <TextField
          label={c.type === "percent" ? "Discount (%)" : "Discount (₹)"}
          required
          type="number"
          min={1}
          prefix={c.type === "flat" ? "₹" : undefined}
          value={c.value || ""}
          error={errors.value}
          onChange={(e) => set("value", Number(e.target.value))}
        />
        <TextField label="Minimum order" prefix="₹" type="number" min={0} value={c.minOrder || ""} hint="Leave empty for no minimum" onChange={(e) => set("minOrder", Number(e.target.value))} />
        {c.type === "percent" ? (
          <TextField label="Maximum discount" prefix="₹" type="number" min={0} value={c.maxDiscount ?? ""} hint="Cap on the discount amount" onChange={(e) => set("maxDiscount", Number(e.target.value) || undefined)} />
        ) : (
          <span className="hidden sm:block" />
        )}
        <TextField label="Starts" type="date" value={toDateInput(c.startsAt)} onChange={(e) => set("startsAt", fromDateInput(e.target.value) ?? c.startsAt)} />
        <TextField label="Ends" type="date" value={toDateInput(c.endsAt)} error={errors.endsAt} hint="Leave empty to never expire" onChange={(e) => set("endsAt", fromDateInput(e.target.value, true))} />
        <TextField
          label="Total uses allowed"
          type="number"
          min={1}
          value={c.usageLimit ?? ""}
          hint="Leave empty for unlimited"
          onChange={(e) => set("usageLimit", e.target.value ? Number(e.target.value) : null)}
        />
        <div className="flex items-end pb-2">
          <Switch className="w-full" label="Active" checked={c.active} onChange={(v) => set("active", v)} />
        </div>
        <TextField
          className="sm:col-span-2"
          label="Customer-facing description"
          value={c.description}
          placeholder={describeCoupon(c)}
          hint="Shown at checkout. Leave empty to use the suggestion."
          onChange={(e) => set("description", e.target.value)}
        />
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:justify-end">
        <button type="button" onClick={onDone} className="btn-ghost btn-sm">
          Cancel
        </button>
        <button type="submit" className="btn-primary btn-sm">
          {coupon ? "Save changes" : "Create coupon"}
        </button>
      </div>
    </form>
  );
}

/* ---------- offer form ---------- */

function OfferForm({ offer, onDone }: { offer: AdminOffer | null; onDone: () => void }) {
  const save = useAdminStore((s) => s.saveOffer);
  const [o, setO] = useState<AdminOffer>(() => offer ?? { id: uid("o"), title: "", subtitle: "", code: "", href: "/shop", active: true });
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!o.title.trim()) {
          setError("Enter a headline.");
          return;
        }
        save({ ...o, title: o.title.trim(), code: o.code?.trim().toUpperCase() || undefined });
        toast.success(offer ? "Offer updated" : "Offer added");
        onDone();
      }}
      noValidate
    >
      <div className="space-y-4 px-5 py-5">
        <div className="overflow-hidden rounded-xl bg-royal px-4 py-2.5 text-center text-[13px] text-white">
          <span className="font-semibold">{o.title || "Your headline"}</span>
          {o.subtitle && <span className="text-white/70"> · {o.subtitle}</span>}
        </div>
        <TextField label="Headline" required value={o.title} error={error ?? undefined} onChange={(e) => setO({ ...o, title: e.target.value })} data-autofocus />
        <TextField label="Supporting text" value={o.subtitle} onChange={(e) => setO({ ...o, subtitle: e.target.value })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Coupon code (optional)" value={o.code ?? ""} inputClassName="font-mono uppercase" onChange={(e) => setO({ ...o, code: e.target.value })} />
          <TextField label="Link" value={o.href} hint="Where tapping the offer goes" onChange={(e) => setO({ ...o, href: e.target.value })} />
        </div>
        <Switch label="Show in announcement bar" checked={o.active} onChange={(v) => setO({ ...o, active: v })} />
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:justify-end">
        <button type="button" onClick={onDone} className="btn-ghost btn-sm">
          Cancel
        </button>
        <button type="submit" className="btn-primary btn-sm">
          {offer ? "Save changes" : "Add offer"}
        </button>
      </div>
    </form>
  );
}

/* ---------- page ---------- */

export function CouponsView() {
  const params = useSearchParams();
  const coupons = useAdminStore((s) => s.coupons);
  const offers = useAdminStore((s) => s.offers);
  const saveCoupon = useAdminStore((s) => s.saveCoupon);
  const deleteCoupon = useAdminStore((s) => s.deleteCoupon);
  const saveOffer = useAdminStore((s) => s.saveOffer);
  const deleteOffer = useAdminStore((s) => s.deleteOffer);
  const [tab, setTab] = useState<"coupons" | "offers">(params.get("tab") === "offers" ? "offers" : "coupons");
  const [couponForm, setCouponForm] = useState<{ open: boolean; coupon: AdminCoupon | null }>({ open: false, coupon: null });
  const [offerForm, setOfferForm] = useState<{ open: boolean; offer: AdminOffer | null }>({ open: false, offer: null });
  const [deleting, setDeleting] = useState<{ kind: "coupon"; item: AdminCoupon } | { kind: "offer"; item: AdminOffer } | null>(null);

  const live = useMemo(() => coupons.filter((c) => couponState(c) === "Live").length, [coupons]);
  const redemptions = coupons.reduce((s, c) => s + c.usageCount, 0);

  const columns: Column<AdminCoupon>[] = [
    {
      id: "code",
      header: "Code",
      sortValue: (c) => c.code,
      cell: (c) => (
        <div className="flex min-w-[200px] items-start gap-2">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-gold bg-gold-soft px-2 py-0.5 font-mono text-[13px] font-semibold tracking-wider text-royal">
              {c.code}
            </span>
            <p className="mt-1 max-w-[280px] text-xs leading-5 text-muted">{c.description}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(c.code).then(
                () => toast.success(`Copied ${c.code}`),
                () => toast.error("Couldn't copy"),
              );
            }}
            className="icon-btn h-8 w-8 shrink-0 text-muted"
            aria-label={`Copy code ${c.code}`}
          >
            <Copy size={14} />
          </button>
        </div>
      ),
    },
    {
      id: "discount",
      header: "Discount",
      sortValue: (c) => c.value,
      hideBelow: "md",
      cell: (c) => (
        <span className="whitespace-nowrap">
          <span className="font-semibold">{c.type === "percent" ? `${c.value}%` : formatPrice(c.value)}</span>
          <span className="block text-xs text-muted">
            {c.minOrder ? `min ${formatPrice(c.minOrder)}` : "no minimum"}
            {c.type === "percent" && c.maxDiscount ? ` · max ${formatPrice(c.maxDiscount)}` : ""}
          </span>
        </span>
      ),
    },
    {
      id: "usage",
      header: "Used",
      sortValue: (c) => c.usageCount,
      hideBelow: "sm",
      cell: (c) => (
        <div className="min-w-[110px]">
          <span className="text-sm tabular-nums">
            <strong>{c.usageCount}</strong>
            <span className="text-muted"> / {c.usageLimit ?? "∞"}</span>
          </span>
          {c.usageLimit !== null && (
            <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-sand" aria-hidden>
              <span className="block h-full rounded-full bg-gold" style={{ width: `${Math.min(100, (c.usageCount / c.usageLimit) * 100)}%` }} />
            </span>
          )}
        </div>
      ),
    },
    {
      id: "validity",
      header: "Valid",
      hideBelow: "lg",
      sortValue: (c) => c.endsAt ?? "9999",
      cell: (c) => (
        <span className="text-xs whitespace-nowrap text-muted">
          {formatDate(c.startsAt)} →<br />
          {c.endsAt ? formatDate(c.endsAt) : "No end date"}
        </span>
      ),
    },
    { id: "state", header: "Status", sortValue: (c) => couponState(c), cell: (c) => <Badge tone={STATE_TONE[couponState(c)]}>{couponState(c)}</Badge> },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (c) => (
        <div className="flex items-center justify-end gap-1">
          <Switch
            hideLabel
            label={`${c.active ? "Disable" : "Enable"} ${c.code}`}
            checked={c.active}
            onChange={(v) => {
              saveCoupon({ ...c, active: v });
              toast.success(`${c.code} ${v ? "enabled" : "disabled"}`);
            }}
            className="mr-1"
          />
          <button type="button" className="icon-btn h-9 w-9 text-muted" onClick={() => setCouponForm({ open: true, coupon: c })} aria-label={`Edit ${c.code}`}>
            <Pencil size={15} />
          </button>
          <button type="button" className="icon-btn h-9 w-9 text-muted hover:bg-danger-soft hover:text-danger" onClick={() => setDeleting({ kind: "coupon", item: c })} aria-label={`Delete ${c.code}`}>
            <Trash2 size={15} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Coupons & Offers" }]}
        title="Coupons & Offers"
        description={`${live} coupons live · ${redemptions.toLocaleString("en-IN")} redemptions so far. Offers appear in the announcement bar at the top of the store.`}
        actions={
          tab === "coupons" ? (
            <button type="button" className="btn-primary btn-sm" onClick={() => setCouponForm({ open: true, coupon: null })}>
              <Plus size={16} aria-hidden /> Create coupon
            </button>
          ) : (
            <button type="button" className="btn-primary btn-sm" onClick={() => setOfferForm({ open: true, offer: null })}>
              <Plus size={16} aria-hidden /> Add offer
            </button>
          )
        }
      />

      <Tabs
        label="Coupons or offers"
        value={tab}
        onChange={setTab}
        className="mb-5"
        items={[
          { value: "coupons", label: "Discount codes", count: coupons.length },
          { value: "offers", label: "Promotional offers", count: offers.length },
        ]}
      />

      {tab === "coupons" ? (
        <div className="card overflow-hidden">
          <DataTable
            caption="Coupons"
            rows={coupons}
            columns={columns}
            getRowId={(c) => c.id}
            empty={<TableEmpty icon={<BadgePercent size={24} />} title="No coupons yet" description="Create a code to reward new or loyal shoppers." />}
          />
        </div>
      ) : (
        <>
          <div className="mb-4 overflow-hidden rounded-[var(--radius-card)] bg-royal px-4 py-2.5 text-center text-[13px] text-white">
            <span className="text-gold-light/80">Live preview · </span>
            {offers.filter((o) => o.active).map((o, i) => (
              <span key={o.id}>
                {i > 0 && <span className="mx-2 text-gold">◆</span>}
                <span className="font-semibold">{o.title}</span>
              </span>
            ))}
            {!offers.some((o) => o.active) && <span className="text-white/60">No active offers — the bar is hidden</span>}
          </div>
          <ul className="grid gap-4 md:grid-cols-2">
            {offers.map((o) => (
              <li key={o.id} className="card flex gap-4 p-5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent" aria-hidden>
                  <Megaphone size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{o.title}</p>
                  <p className="mt-0.5 text-sm text-muted">{o.subtitle}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    {o.code && <span className="rounded-md border border-dashed border-gold bg-gold-soft px-2 py-0.5 font-mono font-semibold text-royal">{o.code}</span>}
                    <span className="text-muted">→ {o.href}</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end justify-between gap-2">
                  <Switch hideLabel label={`Show “${o.title}”`} checked={o.active} onChange={(v) => saveOffer({ ...o, active: v })} />
                  <div className="flex">
                    <button type="button" className="icon-btn h-9 w-9 text-muted" onClick={() => setOfferForm({ open: true, offer: o })} aria-label={`Edit ${o.title}`}>
                      <Pencil size={15} />
                    </button>
                    <button type="button" className="icon-btn h-9 w-9 text-muted hover:bg-danger-soft hover:text-danger" onClick={() => setDeleting({ kind: "offer", item: o })} aria-label={`Delete ${o.title}`}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <Dialog open={couponForm.open} onClose={() => setCouponForm({ open: false, coupon: null })} title={couponForm.coupon ? `Edit ${couponForm.coupon.code}` : "Create coupon"} size="lg">
        {couponForm.open && <CouponForm key={couponForm.coupon?.id ?? "new"} coupon={couponForm.coupon} onDone={() => setCouponForm({ open: false, coupon: null })} />}
      </Dialog>
      <Dialog open={offerForm.open} onClose={() => setOfferForm({ open: false, offer: null })} title={offerForm.offer ? "Edit offer" : "Add offer"}>
        {offerForm.open && <OfferForm key={offerForm.offer?.id ?? "new"} offer={offerForm.offer} onDone={() => setOfferForm({ open: false, offer: null })} />}
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={deleting?.kind === "coupon" ? `Delete ${deleting.item.code}?` : "Delete offer?"}
        description={deleting?.kind === "coupon" ? "Shoppers will no longer be able to use this code. Orders that already used it are not affected." : "It will be removed from the announcement bar."}
        confirmLabel="Delete"
        onConfirm={() => {
          if (!deleting) return;
          if (deleting.kind === "coupon") deleteCoupon(deleting.item.id);
          else deleteOffer(deleting.item.id);
          toast.success("Deleted");
        }}
      />
    </>
  );
}
