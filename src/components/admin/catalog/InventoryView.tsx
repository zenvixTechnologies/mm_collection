"use client";

import { useSearchParams } from "next/navigation";
import { AlertTriangle, Boxes, History, IndianRupee, Minus, PackageX, Plus, SlidersHorizontal } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type { Audience } from "@/types";
import type { InventoryItem, StockAdjustment } from "@/types/admin";
import { stockState, type StockState } from "@/lib/admin/metrics";
import { cn, formatPrice } from "@/lib/utils";
import { useAdminSession, useAdminStore } from "@/store/admin-store";
import { toast } from "@/store/ui-store";
import { Dialog } from "@/components/ui/Dialog";
import { ProductImage } from "@/components/ui/ProductImage";
import { StockBadge } from "../ui/Badge";
import { DataTable, TableEmpty, type Column } from "../ui/DataTable";
import { SelectField, TextField } from "../ui/FormControls";
import { PageHeader } from "../ui/PageHeader";
import { Panel, StatCard } from "../ui/Panel";
import { formatCompactPrice, formatNumber, timeAgo } from "../ui/format";
import { FilterSelect, SearchInput, Tabs, Toolbar } from "../ui/Toolbar";
import { AUDIENCE_OPTIONS } from "./catalog-helpers";

type Filter = "all" | StockState;
const REASONS: StockAdjustment["reason"][] = ["Restock", "Return", "Correction", "Damaged", "Sale"];

/** "M · Ivory" — or nothing for single-variant products. */
const variantLabel = (i: Pick<InventoryItem, "size" | "color">) => [i.size, i.color].filter(Boolean).join(" · ");

/** Out of stock means nothing can be ordered (available = on hand − reserved). */
const stateOf = (i: InventoryItem) => stockState({ stock: i.available, lowStockThreshold: i.lowStockThreshold });

function AdjustDialog({ item, onClose }: { item: InventoryItem | null; onClose: () => void }) {
  const adjust = useAdminStore((s) => s.adjustStock);
  const [mode, setMode] = useState<"add" | "remove" | "set">("add");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState<StockAdjustment["reason"]>("Restock");
  const [saving, setSaving] = useState(false);
  if (!item) return null;
  const n = Math.max(0, Math.floor(Number(qty) || 0));
  // Stock can't go below the units reserved by pending checkouts.
  const floor = item.reserved;
  const change = mode === "add" ? n : mode === "remove" ? -Math.min(n, item.stock - floor) : Math.max(n, floor) - item.stock;
  const after = item.stock + change;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (change === 0) return;
    setSaving(true);
    const res = await adjust({ productId: item.productId, variantSku: item.sku, mode, quantity: mode === "remove" ? -change : mode === "set" ? after : n, reason });
    setSaving(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(`${item.productName}${variantLabel(item) ? ` (${variantLabel(item)})` : ""}: stock ${change > 0 ? "+" : ""}${change} → ${res.data.stock}`);
    onClose();
  };

  return (
    <form onSubmit={submit}>
      <div className="space-y-4 px-5 py-5">
        <div className="flex items-center gap-3 rounded-xl bg-canvas p-3">
          <span className="relative h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-sand">
            {item.image && <ProductImage src={item.image} alt="" fill sizes="44px" />}
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold">{item.productName}</p>
            <p className="text-xs text-muted">
              {[variantLabel(item), item.sku].filter(Boolean).join(" · ")} · {item.stock} in stock
              {item.reserved > 0 && ` (${item.reserved} reserved)`}
            </p>
          </div>
        </div>
        <div role="radiogroup" aria-label="Adjustment type" className="grid grid-cols-3 gap-1 rounded-full border border-line bg-canvas p-1">
          {(
            [
              ["add", "Add"],
              ["remove", "Remove"],
              ["set", "Set to"],
            ] as const
          ).map(([v, l]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={mode === v}
              onClick={() => {
                setMode(v);
                setReason(v === "remove" ? "Damaged" : v === "set" ? "Correction" : "Restock");
              }}
              className={cn("rounded-full py-2 text-sm font-semibold transition-colors", mode === v ? "bg-ink text-white" : "text-muted hover:text-ink")}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={mode === "set" ? "New quantity" : "Quantity"} type="number" min={0} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} data-autofocus />
          <SelectField label="Reason" value={reason} onChange={(e) => setReason(e.target.value as StockAdjustment["reason"])} options={REASONS.map((r) => ({ value: r, label: r }))} />
        </div>
        <p className="rounded-xl border border-line px-4 py-3 text-sm">
          Stock after adjustment:{" "}
          <strong className="tabular-nums">
            {item.stock} → {after}
          </strong>
          {after - item.reserved <= item.lowStockThreshold && <span className="ml-2 text-warning">(at or below alert level)</span>}
          {floor > 0 && <span className="mt-1 block text-xs text-muted">{floor} reserved by pending checkouts — stock can&apos;t go below that.</span>}
        </p>
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:justify-end">
        <button type="button" onClick={onClose} className="btn-ghost btn-sm">
          Cancel
        </button>
        <button type="submit" disabled={change === 0 || saving} className="btn-primary btn-sm">
          {saving ? "Saving…" : "Save adjustment"}
        </button>
      </div>
    </form>
  );
}

function ThresholdInput({ item, disabled }: { item: InventoryItem; disabled: boolean }) {
  const setThreshold = useAdminStore((s) => s.setLowStockThreshold);
  const [v, setV] = useState(String(item.lowStockThreshold));
  const commit = async () => {
    const n = Math.max(0, Math.floor(Number(v) || 0));
    setV(String(n));
    if (n === item.lowStockThreshold) return;
    const res = await setThreshold(item.productId, item.sku, n);
    if (!res.ok) {
      setV(String(item.lowStockThreshold));
      return toast.error(res.error);
    }
    toast.success(`Alert level for ${item.productName}${variantLabel(item) ? ` (${variantLabel(item)})` : ""} set to ${n}`);
  };
  return (
    <input
      type="number"
      min={0}
      value={v}
      disabled={disabled}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      aria-label={`Low-stock alert level for ${item.productName} ${variantLabel(item)}`}
      className="field-input field-sm h-9 w-16 text-center tabular-nums"
    />
  );
}

export function InventoryView() {
  const params = useSearchParams();
  const items = useAdminStore((s) => s.inventory);
  const loading = useAdminStore((s) => s.catalogStatus === "loading" || s.catalogStatus === "idle");
  const adjustments = useAdminStore((s) => s.stockAdjustments);
  const adjust = useAdminStore((s) => s.adjustStock);
  const canWrite = useAdminSession((s) => s.can("inventory:write"));
  const initial = params.get("filter");
  const [filter, setFilter] = useState<Filter>(initial === "low" || initial === "out" || initial === "in" ? initial : "all");
  const [q, setQ] = useState("");
  const [audience, setAudience] = useState<"all" | Audience>("all");
  const [adjusting, setAdjusting] = useState<InventoryItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const tracked = useMemo(() => items.filter((i) => i.status !== "archived"), [items]);
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return tracked.filter(
      (i) =>
        (filter === "all" || stateOf(i) === filter) &&
        (audience === "all" || i.audienceCategory === audience) &&
        (!term || i.productName.toLowerCase().includes(term) || i.sku.toLowerCase().includes(term) || variantLabel(i).toLowerCase().includes(term)),
    );
  }, [tracked, filter, audience, q]);

  const units = tracked.reduce((s, i) => s + i.stock, 0);
  const value = tracked.reduce((s, i) => s + i.stock * i.price, 0);
  const low = tracked.filter((i) => stateOf(i) === "low").length;
  const out = tracked.filter((i) => stateOf(i) === "out").length;
  const productCount = new Set(tracked.map((i) => i.productId)).size;

  const quick = async (i: InventoryItem, change: 1 | -1) => {
    setBusy(i.id);
    const res = await adjust({ productId: i.productId, variantSku: i.sku, mode: change > 0 ? "add" : "remove", quantity: 1, reason: change > 0 ? "Restock" : "Correction" });
    setBusy(null);
    if (!res.ok) toast.error(res.error);
  };

  const columns: Column<InventoryItem>[] = [
    {
      id: "name",
      header: "Product",
      sortValue: (i) => `${i.productName} ${variantLabel(i)}`,
      cell: (i) => (
        <div className="flex min-w-[200px] items-center gap-3">
          <span className="relative h-12 w-10 shrink-0 overflow-hidden rounded-lg bg-sand">
            {i.image && <ProductImage src={i.image} alt="" fill sizes="40px" />}
          </span>
          <span className="min-w-0">
            <span className="block max-w-[260px] truncate font-semibold">{i.productName}</span>
            <span className="text-xs text-muted">
              {[variantLabel(i), i.sku].filter(Boolean).join(" · ")}
              <span className="font-semibold text-ink sm:hidden"> · {i.stock} on hand</span>
            </span>
          </span>
        </div>
      ),
    },
    {
      id: "stock",
      header: "On hand",
      sortValue: (i) => i.available,
      cell: (i) => {
        const state = stateOf(i);
        const pct = Math.min(100, (i.available / Math.max(1, i.lowStockThreshold * 4)) * 100);
        return (
          <div className="flex min-w-[130px] items-center gap-3">
            <span className="w-7 text-right font-semibold tabular-nums" title={i.reserved ? `${i.reserved} reserved by pending checkouts` : undefined}>
              {i.stock}
            </span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sand" aria-hidden>
              <span
                className={cn("block h-full rounded-full", state === "out" ? "bg-danger" : state === "low" ? "bg-gold" : "bg-success")}
                style={{ width: `${Math.max(state === "out" ? 0 : 4, pct)}%` }}
              />
            </span>
            {i.reserved > 0 && <span className="text-[11px] whitespace-nowrap text-muted">{i.reserved} held</span>}
          </div>
        );
      },
    },
    {
      id: "threshold",
      header: "Alert at",
      hideBelow: "md",
      sortValue: (i) => i.lowStockThreshold,
      cell: (i) => <ThresholdInput key={`${i.id}-${i.lowStockThreshold}`} item={i} disabled={!canWrite} />,
    },
    { id: "state", header: "Status", hideBelow: "sm", sortValue: (i) => ["out", "low", "in"].indexOf(stateOf(i)), cell: (i) => <StockBadge state={stateOf(i)} /> },
    { id: "value", header: "Stock value", align: "right", hideBelow: "xl", sortValue: (i) => i.stock * i.price, cell: (i) => <span className="tabular-nums">{formatPrice(i.stock * i.price)}</span> },
    {
      id: "adjust",
      header: <span className="sr-only">Adjust</span>,
      align: "right",
      cell: (i) =>
        canWrite ? (
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-ink hover:bg-sand disabled:opacity-40"
              disabled={i.stock - i.reserved <= 0 || busy === i.id}
              onClick={() => quick(i, -1)}
              aria-label={`Remove one ${i.productName} ${variantLabel(i)}`}
            >
              <Minus size={14} />
            </button>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-ink hover:bg-sand disabled:opacity-40"
              disabled={busy === i.id}
              onClick={() => quick(i, 1)}
              aria-label={`Add one ${i.productName} ${variantLabel(i)}`}
            >
              <Plus size={14} />
            </button>
            <button type="button" className="btn-outline btn-sm ml-1 hidden min-h-8 px-3 sm:inline-flex" onClick={() => setAdjusting(i)}>
              <SlidersHorizontal size={14} aria-hidden /> Adjust
            </button>
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inventory" }]}
        title="Inventory"
        description="Stock is tracked per size and colour. Keep it accurate, set alert levels and restock before items sell out."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Units in stock" value={formatNumber(units)} icon={<Boxes size={18} />} hint={`${productCount} products · ${tracked.length} variants`} />
        <StatCard label="Stock value (retail)" value={formatCompactPrice(value)} icon={<IndianRupee size={18} />} tone="gold" hint={formatPrice(value)} />
        <StatCard label="Low stock" value={low} icon={<AlertTriangle size={18} />} tone="royal" hint="variants at or below alert level" />
        <StatCard label="Out of stock" value={out} icon={<PackageX size={18} />} tone="accent" hint="variants that can't be ordered" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="card min-w-0 self-start overflow-hidden">
          <div className="px-4 pt-3">
            <Tabs<Filter>
              label="Stock filter"
              value={filter}
              onChange={setFilter}
              items={[
                { value: "all", label: "All", count: tracked.length },
                { value: "low", label: "Low stock", count: low },
                { value: "out", label: "Out of stock", count: out },
                { value: "in", label: "Healthy", count: tracked.length - low - out },
              ]}
            />
          </div>
          <Toolbar className="p-4">
            <SearchInput value={q} onChange={setQ} placeholder="Search by name, SKU, size or colour" label="Search inventory" className="sm:max-w-xs sm:flex-1" />
            <FilterSelect
              label="Main category"
              value={audience}
              onChange={setAudience}
              options={[{ value: "all", label: "All main categories" }, ...AUDIENCE_OPTIONS]}
            />
          </Toolbar>
          <DataTable
            caption="Stock levels"
            rows={filtered}
            columns={columns}
            getRowId={(i) => i.id}
            resetKey={`${filter}|${q}|${audience}`}
            pageSize={12}
            initialSort={{ id: "stock", dir: "asc" }}
            empty={
              <TableEmpty
                icon={<Boxes size={24} />}
                title={loading ? "Loading stock…" : "Nothing here"}
                description={loading ? "Fetching the latest stock levels." : filter === "out" ? "No variants are out of stock." : "No variants match."}
              />
            }
          />
        </div>

        <Panel
          className="self-start"
          title={
            <span className="inline-flex items-center gap-2">
              <History size={16} className="text-gold-dark" aria-hidden /> Recent adjustments
            </span>
          }
          flush
        >
          <ul className="max-h-[640px] divide-y divide-line overflow-y-auto">
            {adjustments.slice(0, 20).map((a) => (
              <li key={a.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                <span
                  className={cn(
                    "mt-0.5 w-11 shrink-0 rounded-full py-0.5 text-center text-xs font-bold tabular-nums",
                    a.change > 0 ? "bg-success-soft text-success" : "bg-danger-soft text-danger",
                  )}
                >
                  {a.change > 0 ? "+" : "−"}
                  {Math.abs(a.change)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{a.productName}</span>
                  <span className="block text-xs text-muted">
                    {a.sku} · {a.reason} · now {a.stockAfter} · {a.by}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-subtle">{timeAgo(a.at)}</span>
              </li>
            ))}
            {!adjustments.length && <li className="px-5 py-6 text-sm text-muted">No stock changes yet.</li>}
          </ul>
        </Panel>
      </div>

      <Dialog open={adjusting !== null} onClose={() => setAdjusting(null)} title="Adjust stock">
        <AdjustDialog key={adjusting?.id} item={adjusting} onClose={() => setAdjusting(null)} />
      </Dialog>
    </>
  );
}
