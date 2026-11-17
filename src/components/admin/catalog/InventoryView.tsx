"use client";

import { useSearchParams } from "next/navigation";
import { AlertTriangle, Boxes, History, IndianRupee, Minus, PackageX, Plus, SlidersHorizontal } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type { Audience } from "@/types";
import type { AdminProduct, StockAdjustment } from "@/types/admin";
import { stockState, type StockState } from "@/lib/admin/metrics";
import { cn, formatPrice } from "@/lib/utils";
import { useAdminStore } from "@/store/admin-store";
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

type Filter = "all" | StockState;
const REASONS: StockAdjustment["reason"][] = ["Restock", "Return", "Correction", "Damaged", "Sale"];

function AdjustDialog({ product, onClose }: { product: AdminProduct | null; onClose: () => void }) {
  const adjust = useAdminStore((s) => s.adjustStock);
  const [mode, setMode] = useState<"add" | "remove" | "set">("add");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState<StockAdjustment["reason"]>("Restock");
  if (!product) return null;
  const n = Math.max(0, Math.floor(Number(qty) || 0));
  const change = mode === "add" ? n : mode === "remove" ? -Math.min(n, product.stock) : n - product.stock;
  const after = product.stock + change;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (change === 0) return;
    adjust(product.id, change, reason);
    toast.success(`${product.name}: stock ${change > 0 ? "+" : ""}${change} → ${after}`);
    onClose();
  };

  return (
    <form onSubmit={submit}>
      <div className="space-y-4 px-5 py-5">
        <div className="flex items-center gap-3 rounded-xl bg-canvas p-3">
          <span className="relative h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-sand">
            {product.images[0] && <ProductImage src={product.images[0]} alt="" fill sizes="44px" unoptimized={product.images[0].startsWith("blob:")} />}
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold">{product.name}</p>
            <p className="text-xs text-muted">
              {product.sku} · {product.stock} in stock
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
            {product.stock} → {after}
          </strong>
          {after <= product.lowStockThreshold && <span className="ml-2 text-warning">(at or below alert level)</span>}
        </p>
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:justify-end">
        <button type="button" onClick={onClose} className="btn-ghost btn-sm">
          Cancel
        </button>
        <button type="submit" disabled={change === 0} className="btn-primary btn-sm">
          Save adjustment
        </button>
      </div>
    </form>
  );
}

function ThresholdInput({ product }: { product: AdminProduct }) {
  const setThreshold = useAdminStore((s) => s.setLowStockThreshold);
  const [v, setV] = useState(String(product.lowStockThreshold));
  const commit = () => {
    const n = Math.max(0, Math.floor(Number(v) || 0));
    setV(String(n));
    if (n !== product.lowStockThreshold) {
      setThreshold(product.id, n);
      toast.success(`Alert level for ${product.name} set to ${n}`);
    }
  };
  return (
    <input
      type="number"
      min={0}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      aria-label={`Low-stock alert level for ${product.name}`}
      className="field-input field-sm h-9 w-16 text-center tabular-nums"
    />
  );
}

export function InventoryView() {
  const params = useSearchParams();
  const products = useAdminStore((s) => s.products);
  const adjustments = useAdminStore((s) => s.stockAdjustments);
  const adjust = useAdminStore((s) => s.adjustStock);
  const initial = params.get("filter");
  const [filter, setFilter] = useState<Filter>(initial === "low" || initial === "out" || initial === "in" ? initial : "all");
  const [q, setQ] = useState("");
  const [audience, setAudience] = useState<"all" | Audience>("all");
  const [adjusting, setAdjusting] = useState<AdminProduct | null>(null);

  const tracked = useMemo(() => products.filter((p) => p.status !== "archived"), [products]);
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return tracked.filter(
      (p) =>
        (filter === "all" || stockState(p) === filter) &&
        (audience === "all" || p.audienceCategory === audience) &&
        (!term || p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term)),
    );
  }, [tracked, filter, audience, q]);

  const units = tracked.reduce((s, p) => s + p.stock, 0);
  const value = tracked.reduce((s, p) => s + p.stock * p.price, 0);
  const low = tracked.filter((p) => stockState(p) === "low").length;
  const out = tracked.filter((p) => stockState(p) === "out").length;

  const columns: Column<AdminProduct>[] = [
    {
      id: "name",
      header: "Product",
      sortValue: (p) => p.name,
      cell: (p) => (
        <div className="flex min-w-[200px] items-center gap-3">
          <span className="relative h-12 w-10 shrink-0 overflow-hidden rounded-lg bg-sand">
            {p.images[0] && <ProductImage src={p.images[0]} alt="" fill sizes="40px" unoptimized={p.images[0].startsWith("blob:")} />}
          </span>
          <span className="min-w-0">
            <span className="block max-w-[260px] truncate font-semibold">{p.name}</span>
            <span className="text-xs text-muted">
              {p.sku}
              <span className="font-semibold text-ink sm:hidden"> · {p.stock} on hand</span>
            </span>
          </span>
        </div>
      ),
    },
    {
      id: "stock",
      header: "On hand",
      sortValue: (p) => p.stock,
      cell: (p) => {
        const state = stockState(p);
        const pct = Math.min(100, (p.stock / Math.max(1, p.lowStockThreshold * 4)) * 100);
        return (
          <div className="flex min-w-[130px] items-center gap-3">
            <span className="w-7 text-right font-semibold tabular-nums">{p.stock}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sand" aria-hidden>
              <span
                className={cn("block h-full rounded-full", state === "out" ? "bg-danger" : state === "low" ? "bg-gold" : "bg-success")}
                style={{ width: `${Math.max(state === "out" ? 0 : 4, pct)}%` }}
              />
            </span>
          </div>
        );
      },
    },
    { id: "threshold", header: "Alert at", hideBelow: "md", sortValue: (p) => p.lowStockThreshold, cell: (p) => <ThresholdInput key={`${p.id}-${p.lowStockThreshold}`} product={p} /> },
    { id: "state", header: "Status", hideBelow: "sm", sortValue: (p) => ["out", "low", "in"].indexOf(stockState(p)), cell: (p) => <StockBadge state={stockState(p)} /> },
    { id: "value", header: "Stock value", align: "right", hideBelow: "xl", sortValue: (p) => p.stock * p.price, cell: (p) => <span className="tabular-nums">{formatPrice(p.stock * p.price)}</span> },
    {
      id: "adjust",
      header: <span className="sr-only">Adjust</span>,
      align: "right",
      cell: (p) => (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-ink hover:bg-sand disabled:opacity-40"
            disabled={p.stock === 0}
            onClick={() => adjust(p.id, -1, "Correction")}
            aria-label={`Remove one ${p.name}`}
          >
            <Minus size={14} />
          </button>
          <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-ink hover:bg-sand" onClick={() => adjust(p.id, 1, "Restock")} aria-label={`Add one ${p.name}`}>
            <Plus size={14} />
          </button>
          <button type="button" className="btn-outline btn-sm ml-1 hidden min-h-8 px-3 sm:inline-flex" onClick={() => setAdjusting(p)}>
            <SlidersHorizontal size={14} aria-hidden /> Adjust
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inventory" }]}
        title="Inventory"
        description="Keep stock accurate, set alert levels per product and restock before items sell out."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Units in stock" value={formatNumber(units)} icon={<Boxes size={18} />} hint={`${tracked.length} products`} />
        <StatCard label="Stock value (retail)" value={formatCompactPrice(value)} icon={<IndianRupee size={18} />} tone="gold" hint={formatPrice(value)} />
        <StatCard label="Low stock" value={low} icon={<AlertTriangle size={18} />} tone="royal" hint="at or below alert level" />
        <StatCard label="Out of stock" value={out} icon={<PackageX size={18} />} tone="accent" hint="can't be ordered" />
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
            <SearchInput value={q} onChange={setQ} placeholder="Search by name or SKU" label="Search inventory" className="sm:max-w-xs sm:flex-1" />
            <FilterSelect
              label="Audience"
              value={audience}
              onChange={setAudience}
              options={[
                { value: "all", label: "All audiences" },
                { value: "women", label: "Women" },
                { value: "men", label: "Men" },
                { value: "kids", label: "Kids" },
              ]}
            />
          </Toolbar>
          <DataTable
            caption="Stock levels"
            rows={filtered}
            columns={columns}
            getRowId={(p) => p.id}
            resetKey={`${filter}|${q}|${audience}`}
            pageSize={12}
            initialSort={{ id: "stock", dir: "asc" }}
            empty={<TableEmpty icon={<Boxes size={24} />} title="Nothing here" description={filter === "out" ? "No products are out of stock." : "No products match."} />}
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
                    {a.reason} · now {a.stockAfter} · {a.by}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-subtle">{timeAgo(a.at)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Dialog open={adjusting !== null} onClose={() => setAdjusting(null)} title="Adjust stock">
        <AdjustDialog key={adjusting?.id} product={adjusting} onClose={() => setAdjusting(null)} />
      </Dialog>
    </>
  );
}
