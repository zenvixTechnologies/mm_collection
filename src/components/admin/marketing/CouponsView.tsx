"use client";

import { useSearchParams } from "next/navigation";
import { BadgePercent, Copy, History, Loader2, Megaphone, Pencil, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type { CouponType } from "@/types";
import type { AdminCoupon, AdminOffer, AdminPage, CouponUsage } from "@/types/admin";
import { istDateKey } from "@/data/admin/mock-utils";
import { useAdminQuery, withQuery } from "@/hooks/use-admin-query";
import { useDebounced } from "@/hooks/use-debounced";
import { adminApi, errorMessage, AdminApiError } from "@/lib/admin-api";
import { formatDate, formatPrice } from "@/lib/utils";
import { useAdminSession, useAdminStore } from "@/store/admin-store";
import { toast } from "@/store/ui-store";
import { Dialog } from "@/components/ui/Dialog";
import { Badge, type BadgeTone } from "../ui/Badge";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { DataTable, TableEmpty, type Column } from "../ui/DataTable";
import { SelectField, Switch, TextField } from "../ui/FormControls";
import { PageHeader } from "../ui/PageHeader";
import { LoadError, TableSkeleton } from "../ui/QueryState";
import { FilterSelect, SearchInput, Tabs, Toolbar } from "../ui/Toolbar";

/* ---------- helpers ---------- */

type CouponState = "Live" | "Scheduled" | "Expired" | "Used up" | "Disabled";
const STATE_TONE: Record<CouponState, BadgeTone> = { Live: "success", Scheduled: "gold", Expired: "muted", "Used up": "muted", Disabled: "neutral" };
type StateFilter = "all" | "live" | "scheduled" | "expired" | "used_up" | "disabled";
type CouponPage = AdminPage<AdminCoupon> & { summary: { all: number; live: number; redemptions: number } };

export function couponState(c: AdminCoupon, now = Date.now()): CouponState {
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
const paise = (rupees: number) => Math.round(rupees * 100);

/** API field errors → { field: message } (first message per field). */
function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof AdminApiError) || !err.issues?.length) return {};
  const map: Record<string, string> = {};
  for (const i of err.issues) {
    const key = i.path.split(".")[0].replace("Paise", "").replace(/^value$/, "value");
    const k = key === "minOrder" ? "minOrder" : key === "maxDiscount" ? "maxDiscount" : key;
    map[k] ??= i.message;
  }
  return map;
}

/* ---------- include/exclude picker ---------- */

function RefPicker({ label, options, value, onChange, hint }: { label: string; options: { id: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; hint?: string }) {
  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    return options.filter((o) => !value.includes(o.id) && (!t || o.label.toLowerCase().includes(t))).slice(0, 8);
  }, [options, value, q]);
  const nameOf = (id: string) => options.find((o) => o.id === id)?.label ?? id;
  return (
    <div className="min-w-0">
      <p className="field-label">{label}</p>
      {value.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {value.map((id) => (
            <li key={id} className="inline-flex items-center gap-1 rounded-full bg-sand px-2.5 py-1 text-xs">
              {nameOf(id)}
              <button type="button" onClick={() => onChange(value.filter((x) => x !== id))} className="text-muted hover:text-ink" aria-label={`Remove ${nameOf(id)}`}>
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <SearchInput value={q} onChange={setQ} placeholder="Search to add…" label={`Search ${label.toLowerCase()}`} />
      {q.trim() && (
        <ul className="mt-1 max-h-40 overflow-y-auto rounded-xl border border-line bg-white text-sm">
          {matches.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left hover:bg-canvas"
                onClick={() => {
                  onChange([...value, o.id]);
                  setQ("");
                }}
              >
                {o.label}
              </button>
            </li>
          ))}
          {!matches.length && <li className="px-3 py-2 text-muted">No matches</li>}
        </ul>
      )}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/* ---------- coupon form ---------- */

function CouponForm({ coupon, onDone }: { coupon: AdminCoupon | null; onDone: (saved: boolean) => void }) {
  const products = useAdminStore((s) => s.products);
  const categories = useAdminStore((s) => s.categories);
  const productOptions = useMemo(() => products.map((p) => ({ id: p.id, label: `${p.name} (${p.sku})` })), [products]);
  const categoryOptions = useMemo(() => categories.map((c) => ({ id: c.slug, label: `${c.name} · ${c.audience}` })), [categories]);
  const [c, setC] = useState<AdminCoupon>(
    () =>
      coupon ?? {
        id: "",
        code: "",
        type: "percent",
        value: 10,
        minOrder: 0,
        maxDiscount: 500,
        description: "",
        active: true,
        listed: true,
        usageCount: 0,
        usageLimit: null,
        perCustomerLimit: null,
        startsAt: new Date().toISOString(),
        endsAt: null,
        products: [],
        categories: [],
        excludedProducts: [],
        excludedCategories: [],
      },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof AdminCoupon>(k: K, v: AdminCoupon[K]) => setC((p) => ({ ...p, [k]: v }));
  const used = (coupon?.usageCount ?? 0) > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const code = c.code.trim().toUpperCase();
    const errs: Record<string, string> = {};
    if (!/^[A-Z0-9_-]{3,40}$/.test(code)) errs.code = "Use 3–40 letters, numbers, - or _ (no spaces).";
    if (!(c.value > 0)) errs.value = "Enter a discount.";
    else if (c.type === "percent" && (c.value > 90 || !Number.isInteger(c.value))) errs.value = "Percentage discounts are whole numbers up to 90%.";
    if (c.endsAt && new Date(c.endsAt) <= new Date(c.startsAt)) errs.endsAt = "End date must be after the start date.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const body = {
      code,
      type: c.type,
      value: c.type === "flat" ? paise(c.value) : c.value,
      minOrderPaise: paise(c.minOrder || 0),
      maxDiscountPaise: c.type === "percent" && c.maxDiscount ? paise(c.maxDiscount) : null,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      usageLimit: c.usageLimit,
      perCustomerLimit: c.perCustomerLimit ?? null,
      active: c.active,
      listed: c.listed !== false,
      description: c.description.trim(),
      products: c.products ?? [],
      categories: c.categories ?? [],
      excludedProducts: c.excludedProducts ?? [],
      excludedCategories: c.excludedCategories ?? [],
    };
    setSaving(true);
    try {
      if (coupon) await adminApi(`/coupons/${coupon.id}`, { method: "PATCH", body });
      else await adminApi("/coupons", { method: "POST", body });
      toast.success(coupon ? `Coupon ${code} updated` : `Coupon ${code} created`);
      onDone(true);
    } catch (err) {
      const fields = fieldErrors(err);
      setErrors(Object.keys(fields).length ? fields : { form: errorMessage(err) });
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
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
          maxLength={40}
          disabled={used}
          hint={used ? "Used on orders — the code can't change." : undefined}
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
          step={c.type === "percent" ? 1 : 0.01}
          prefix={c.type === "flat" ? "₹" : undefined}
          value={c.value || ""}
          error={errors.value}
          onChange={(e) => set("value", Number(e.target.value))}
        />
        <TextField label="Minimum order" prefix="₹" type="number" min={0} value={c.minOrder || ""} error={errors.minOrder} hint="Leave empty for no minimum" onChange={(e) => set("minOrder", Number(e.target.value))} />
        {c.type === "percent" ? (
          <TextField label="Maximum discount" prefix="₹" type="number" min={0} value={c.maxDiscount ?? ""} error={errors.maxDiscount} hint="Cap on the discount amount" onChange={(e) => set("maxDiscount", Number(e.target.value) || undefined)} />
        ) : (
          <span className="hidden sm:block" />
        )}
        <TextField label="Starts" type="date" value={toDateInput(c.startsAt)} onChange={(e) => set("startsAt", fromDateInput(e.target.value) ?? c.startsAt)} />
        <TextField label="Ends" type="date" value={toDateInput(c.endsAt)} error={errors.endsAt} hint="Leave empty to never expire" onChange={(e) => set("endsAt", fromDateInput(e.target.value, true))} />
        <TextField
          label="Total uses allowed"
          type="number"
          min={Math.max(1, coupon?.usageCount ?? 1)}
          value={c.usageLimit ?? ""}
          error={errors.usageLimit}
          hint={used ? `Used ${coupon!.usageCount} times so far` : "Leave empty for unlimited"}
          onChange={(e) => set("usageLimit", e.target.value ? Number(e.target.value) : null)}
        />
        <TextField
          label="Uses per customer"
          type="number"
          min={1}
          value={c.perCustomerLimit ?? ""}
          error={errors.perCustomerLimit}
          hint="Counted by account or email. Empty = unlimited"
          onChange={(e) => set("perCustomerLimit", e.target.value ? Number(e.target.value) : null)}
        />
        <Switch className="w-full" label="Active" checked={c.active} onChange={(v) => set("active", v)} />
        <Switch className="w-full" label="Show in “available coupons”" checked={c.listed !== false} onChange={(v) => set("listed", v)} />
        <TextField
          className="sm:col-span-2"
          label="Customer-facing description"
          value={c.description}
          maxLength={200}
          placeholder={describeCoupon(c)}
          hint="Shown at checkout. Leave empty to use the suggestion."
          onChange={(e) => set("description", e.target.value)}
        />
        <div className="grid gap-4 border-t border-line pt-4 sm:col-span-2 sm:grid-cols-2">
          <p className="text-sm font-semibold sm:col-span-2">Where it applies</p>
          <RefPicker label="Only these categories" options={categoryOptions} value={c.categories ?? []} onChange={(v) => set("categories", v)} hint="Empty = every category" />
          <RefPicker label="Only these products" options={productOptions} value={c.products ?? []} onChange={(v) => set("products", v)} hint="Empty = every product" />
          <RefPicker label="Never on these categories" options={categoryOptions} value={c.excludedCategories ?? []} onChange={(v) => set("excludedCategories", v)} />
          <RefPicker label="Never on these products" options={productOptions} value={c.excludedProducts ?? []} onChange={(v) => set("excludedProducts", v)} />
          {(errors.excludedProducts || errors.excludedCategories || errors.products || errors.categories) && (
            <p className="field-error sm:col-span-2">{errors.excludedProducts ?? errors.excludedCategories ?? errors.products ?? errors.categories}</p>
          )}
        </div>
        {errors.form && <p className="field-error sm:col-span-2" role="alert">{errors.form}</p>}
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:justify-end">
        <button type="button" onClick={() => onDone(false)} className="btn-ghost btn-sm" disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="btn-primary btn-sm" disabled={saving}>
          {saving && <Loader2 size={14} className="animate-spin" aria-hidden />}
          {coupon ? "Save changes" : "Create coupon"}
        </button>
      </div>
    </form>
  );
}

/* ---------- usage history ---------- */

function CouponUsageList({ coupon }: { coupon: AdminCoupon }) {
  const [page, setPage] = useState(1);
  const { data, status, error, refreshing, reload } = useAdminQuery<AdminPage<CouponUsage>>(withQuery(`/coupons/${coupon.id}/usage`, { page, limit: 10 }));
  const columns: Column<CouponUsage>[] = [
    { id: "order", header: "Order", cell: (u) => (u.orderId ? <a href={`/mm-hub/orders/${u.orderId}`} className="font-semibold hover:text-accent hover:underline">{u.orderId}</a> : "—") },
    { id: "customer", header: "Customer", cell: (u) => <span className="block max-w-[180px] truncate">{u.customer || u.email}</span> },
    { id: "discount", header: "Discount", align: "right", cell: (u) => <span className="tabular-nums">{formatPrice(u.discount)}</span> },
    { id: "status", header: "Status", cell: (u) => <Badge tone={u.status === "redeemed" ? "success" : u.status === "reserved" ? "warning" : "muted"}>{u.status === "reserved" ? "awaiting payment" : u.status}</Badge> },
    { id: "at", header: "When", hideBelow: "sm", cell: (u) => <span className="whitespace-nowrap text-muted">{formatDate(u.at, true)}</span> },
  ];
  if (status === "loading") return <TableSkeleton rows={4} />;
  if (status === "error") return <LoadError message={error} onRetry={reload} />;
  return (
    <DataTable
      caption={`Orders that used ${coupon.code}`}
      rows={data?.items ?? []}
      columns={columns}
      getRowId={(u) => `${u.orderId}-${u.at}`}
      server={{ page, totalPages: data?.totalPages ?? 1, total: data?.total ?? 0, limit: 10, onPageChange: setPage, loading: refreshing }}
      empty={<TableEmpty icon={<History size={24} />} title="Not used yet" />}
    />
  );
}

/* ---------- offer form ---------- */

function OfferForm({ offer, onDone }: { offer: AdminOffer | null; onDone: (saved: boolean) => void }) {
  const [o, setO] = useState<AdminOffer>(() => offer ?? { id: "", title: "", subtitle: "", code: "", href: "/shop", active: true });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!o.title.trim()) return setError("Enter a headline.");
        setSaving(true);
        try {
          const body = { title: o.title.trim(), subtitle: o.subtitle.trim(), code: o.code?.trim().toUpperCase() || null, href: o.href.trim() || "/shop", active: o.active };
          if (offer) await adminApi(`/offers/${offer.id}`, { method: "PATCH", body });
          else await adminApi("/offers", { method: "POST", body });
          toast.success(offer ? "Offer updated" : "Offer added");
          onDone(true);
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setSaving(false);
        }
      }}
      noValidate
    >
      <div className="space-y-4 px-5 py-5">
        <div className="overflow-hidden rounded-xl bg-royal px-4 py-2.5 text-center text-[13px] text-white">
          <span className="font-semibold">{o.title || "Your headline"}</span>
          {o.subtitle && <span className="text-white/70"> · {o.subtitle}</span>}
        </div>
        <TextField label="Headline" required maxLength={120} value={o.title} error={error ?? undefined} onChange={(e) => setO({ ...o, title: e.target.value })} data-autofocus />
        <TextField label="Supporting text" maxLength={200} value={o.subtitle} onChange={(e) => setO({ ...o, subtitle: e.target.value })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Coupon code (optional)" maxLength={40} value={o.code ?? ""} inputClassName="font-mono uppercase" onChange={(e) => setO({ ...o, code: e.target.value })} />
          <TextField label="Link" maxLength={300} value={o.href} hint="A store path like /shop, or https://…" onChange={(e) => setO({ ...o, href: e.target.value })} />
        </div>
        <Switch label="Show in announcement bar" checked={o.active} onChange={(v) => setO({ ...o, active: v })} />
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:justify-end">
        <button type="button" onClick={() => onDone(false)} className="btn-ghost btn-sm" disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="btn-primary btn-sm" disabled={saving}>
          {saving && <Loader2 size={14} className="animate-spin" aria-hidden />}
          {offer ? "Save changes" : "Add offer"}
        </button>
      </div>
    </form>
  );
}

/* ---------- page ---------- */

const PAGE_SIZE = 20;

export function CouponsView() {
  const params = useSearchParams();
  const canWrite = useAdminSession((s) => s.can("coupons:write"));
  const [tab, setTab] = useState<"coupons" | "offers">(params.get("tab") === "offers" ? "offers" : "coupons");
  const [q, setQ] = useState("");
  const [state, setState] = useState<StateFilter>("all");
  const [page, setPage] = useState(1);
  const term = useDebounced(q.trim());
  const filterKey = `${term}|${state}`;
  const [lastKey, setLastKey] = useState(filterKey);
  if (filterKey !== lastKey) {
    setLastKey(filterKey);
    setPage(1);
  }
  const coupons = useAdminQuery<CouponPage>(withQuery("/coupons", { q: term, state: state === "all" ? undefined : state, page, limit: PAGE_SIZE }));
  const offersQuery = useAdminQuery<AdminOffer[]>("/offers");
  const offers = offersQuery.data ?? [];
  const [couponForm, setCouponForm] = useState<{ open: boolean; coupon: AdminCoupon | null }>({ open: false, coupon: null });
  const [usageFor, setUsageFor] = useState<AdminCoupon | null>(null);
  const [offerForm, setOfferForm] = useState<{ open: boolean; offer: AdminOffer | null }>({ open: false, offer: null });
  const [deleting, setDeleting] = useState<{ kind: "coupon"; item: AdminCoupon } | { kind: "offer"; item: AdminOffer } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const summary = coupons.data?.summary;

  const toggleCoupon = async (c: AdminCoupon, active: boolean) => {
    setBusyId(c.id);
    try {
      await adminApi(`/coupons/${c.id}`, { method: "PATCH", body: { active } });
      toast.success(`${c.code} ${active ? "enabled" : "disabled"}`);
      coupons.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const toggleOffer = async (o: AdminOffer, active: boolean) => {
    setBusyId(o.id);
    try {
      await adminApi(`/offers/${o.id}`, { method: "PATCH", body: { active } });
      offersQuery.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const columns: Column<AdminCoupon>[] = [
    {
      id: "code",
      header: "Code",
      cell: (c) => (
        <div className="flex min-w-[200px] items-start gap-2">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-gold bg-gold-soft px-2 py-0.5 font-mono text-[13px] font-semibold tracking-wider text-royal">
              {c.code}
            </span>
            <p className="mt-1 max-w-[280px] text-xs leading-5 text-muted">{c.description}</p>
            {(c.categories?.length || c.products?.length || c.excludedCategories?.length || c.excludedProducts?.length) ? (
              <p className="text-xs text-muted">Restricted to some items{c.listed === false ? " · hidden from list" : ""}</p>
            ) : c.listed === false ? (
              <p className="text-xs text-muted">Hidden from the available-coupons list</p>
            ) : null}
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
      hideBelow: "sm",
      cell: (c) => (
        <div className="min-w-[110px]">
          <button type="button" onClick={() => setUsageFor(c)} className="text-sm tabular-nums hover:underline" aria-label={`Usage history for ${c.code}`}>
            <strong>{c.usageCount}</strong>
            <span className="text-muted"> / {c.usageLimit ?? "∞"}</span>
            {c.perCustomerLimit ? <span className="ml-1 text-xs text-muted">({c.perCustomerLimit}/customer)</span> : null}
          </button>
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
      cell: (c) => (
        <span className="text-xs whitespace-nowrap text-muted">
          {formatDate(c.startsAt)} →<br />
          {c.endsAt ? formatDate(c.endsAt) : "No end date"}
        </span>
      ),
    },
    { id: "state", header: "Status", cell: (c) => <Badge tone={STATE_TONE[couponState(c)]}>{couponState(c)}</Badge> },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (c) => (
        <div className="flex items-center justify-end gap-1">
          {canWrite && (
            <Switch hideLabel label={`${c.active ? "Disable" : "Enable"} ${c.code}`} checked={c.active} disabled={busyId === c.id} onChange={(v) => void toggleCoupon(c, v)} className="mr-1" />
          )}
          <button type="button" className="icon-btn h-9 w-9 text-muted" onClick={() => setUsageFor(c)} aria-label={`Usage history for ${c.code}`}>
            <History size={15} />
          </button>
          {canWrite && (
            <>
              <button type="button" className="icon-btn h-9 w-9 text-muted" onClick={() => setCouponForm({ open: true, coupon: c })} aria-label={`Edit ${c.code}`}>
                <Pencil size={15} />
              </button>
              <button type="button" className="icon-btn h-9 w-9 text-muted hover:bg-danger-soft hover:text-danger" onClick={() => setDeleting({ kind: "coupon", item: c })} aria-label={`Delete ${c.code}`}>
                <Trash2 size={15} />
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Coupons & Offers" }]}
        title="Coupons & Offers"
        description={`${summary?.live ?? 0} coupons live · ${(summary?.redemptions ?? 0).toLocaleString("en-IN")} redemptions so far. Offers appear in the announcement bar at the top of the store.`}
        actions={
          canWrite &&
          (tab === "coupons" ? (
            <button type="button" className="btn-primary btn-sm" onClick={() => setCouponForm({ open: true, coupon: null })}>
              <Plus size={16} aria-hidden /> Create coupon
            </button>
          ) : (
            <button type="button" className="btn-primary btn-sm" onClick={() => setOfferForm({ open: true, offer: null })}>
              <Plus size={16} aria-hidden /> Add offer
            </button>
          ))
        }
      />

      <Tabs
        label="Coupons or offers"
        value={tab}
        onChange={setTab}
        className="mb-5"
        items={[
          { value: "coupons", label: "Discount codes", count: summary?.all ?? 0 },
          { value: "offers", label: "Promotional offers", count: offers.length },
        ]}
      />

      {tab === "coupons" ? (
        <div className="card overflow-hidden">
          <Toolbar className="p-4">
            <SearchInput value={q} onChange={setQ} placeholder="Coupon code" label="Search coupons" className="sm:max-w-xs sm:flex-1" />
            <FilterSelect
              label="Coupon status"
              value={state}
              onChange={setState}
              options={[
                { value: "all", label: "All statuses" },
                { value: "live", label: "Live" },
                { value: "scheduled", label: "Scheduled" },
                { value: "expired", label: "Expired" },
                { value: "used_up", label: "Used up" },
                { value: "disabled", label: "Disabled" },
              ]}
            />
          </Toolbar>
          {coupons.status === "loading" ? (
            <TableSkeleton />
          ) : coupons.status === "error" ? (
            <LoadError title="Couldn't load coupons" message={coupons.error} onRetry={coupons.reload} />
          ) : (
            <DataTable
              caption="Coupons"
              rows={coupons.data?.items ?? []}
              columns={columns}
              getRowId={(c) => c.id}
              server={{ page, totalPages: coupons.data?.totalPages ?? 1, total: coupons.data?.total ?? 0, limit: PAGE_SIZE, onPageChange: setPage, loading: coupons.refreshing }}
              empty={<TableEmpty icon={<BadgePercent size={24} />} title="No coupons found" description="Create a code to reward new or loyal shoppers." />}
            />
          )}
        </div>
      ) : offersQuery.status === "loading" ? (
        <TableSkeleton rows={3} />
      ) : offersQuery.status === "error" ? (
        <div className="card">
          <LoadError title="Couldn't load offers" message={offersQuery.error} onRetry={offersQuery.reload} />
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
          {offers.length === 0 && (
            <div className="card py-12">
              <TableEmpty icon={<Megaphone size={24} />} title="No offers yet" description="Add a short message for the announcement bar." />
            </div>
          )}
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
                {canWrite && (
                  <div className="flex shrink-0 flex-col items-end justify-between gap-2">
                    <Switch hideLabel label={`Show “${o.title}”`} checked={o.active} disabled={busyId === o.id} onChange={(v) => void toggleOffer(o, v)} />
                    <div className="flex">
                      <button type="button" className="icon-btn h-9 w-9 text-muted" onClick={() => setOfferForm({ open: true, offer: o })} aria-label={`Edit ${o.title}`}>
                        <Pencil size={15} />
                      </button>
                      <button type="button" className="icon-btn h-9 w-9 text-muted hover:bg-danger-soft hover:text-danger" onClick={() => setDeleting({ kind: "offer", item: o })} aria-label={`Delete ${o.title}`}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <Dialog open={couponForm.open} onClose={() => setCouponForm({ open: false, coupon: null })} title={couponForm.coupon ? `Edit ${couponForm.coupon.code}` : "Create coupon"} size="lg">
        {couponForm.open && (
          <CouponForm
            key={couponForm.coupon?.id ?? "new"}
            coupon={couponForm.coupon}
            onDone={(saved) => {
              setCouponForm({ open: false, coupon: null });
              if (saved) coupons.reload();
            }}
          />
        )}
      </Dialog>
      <Dialog open={usageFor !== null} onClose={() => setUsageFor(null)} title={usageFor ? `${usageFor.code} — usage` : "Usage"} size="lg">
        {usageFor && <CouponUsageList key={usageFor.id} coupon={usageFor} />}
      </Dialog>
      <Dialog open={offerForm.open} onClose={() => setOfferForm({ open: false, offer: null })} title={offerForm.offer ? "Edit offer" : "Add offer"}>
        {offerForm.open && (
          <OfferForm
            key={offerForm.offer?.id ?? "new"}
            offer={offerForm.offer}
            onDone={(saved) => {
              setOfferForm({ open: false, offer: null });
              if (saved) offersQuery.reload();
            }}
          />
        )}
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={deleting?.kind === "coupon" ? `Delete ${deleting.item.code}?` : "Delete offer?"}
        description={
          deleting?.kind === "coupon"
            ? deleting.item.usageCount > 0
              ? "This coupon has been used, so it can't be deleted — disable it instead. Past orders keep their discount."
              : "Shoppers will no longer be able to use this code."
            : "It will be removed from the announcement bar."
        }
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await adminApi(deleting.kind === "coupon" ? `/coupons/${deleting.item.id}` : `/offers/${deleting.item.id}`, { method: "DELETE" });
            toast.success("Deleted");
            if (deleting.kind === "coupon") coupons.reload();
            else offersQuery.reload();
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
    </>
  );
}
