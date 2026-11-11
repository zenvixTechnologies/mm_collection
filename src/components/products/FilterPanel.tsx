"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Product, Size } from "@/types";
import { categories } from "@/data/categories";
import { ALL_SIZES, productInCategory } from "@/data/products";
import { DISCOUNT_OPTIONS, type Filters } from "@/lib/catalog";
import { cn, formatPrice } from "@/lib/utils";

interface FilterPanelProps {
  filters: Filters;
  onChange: (f: Filters) => void;
  /** Products available before filtering — used to show only relevant options and counts. */
  source: Product[];
  hideCategory?: boolean;
}

const PRICE_RANGES: { label: string; min: number | null; max: number | null }[] = [
  { label: "Under ₹1,000", min: null, max: 999 },
  { label: "₹1,000 – ₹1,499", min: 1000, max: 1499 },
  { label: "₹1,500 – ₹1,999", min: 1500, max: 1999 },
  { label: "₹2,000 – ₹2,999", min: 2000, max: 2999 },
  { label: "₹3,000 & above", min: 3000, max: null },
];

function toggle<T>(list: T[], value: T) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function FilterPanel({ filters, onChange, source, hideCategory }: FilterPanelProps) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });

  const sizes = ALL_SIZES.filter((s) => source.some((p) => p.sizes.includes(s)));
  const colors = Array.from(new Map(source.flatMap((p) => p.colors).map((c) => [c.name, c])).values());
  const cats = categories.filter((c) => source.some((p) => productInCategory(p, c.id)));
  const [minIn, setMinIn] = useState(filters.minPrice?.toString() ?? "");
  const [maxIn, setMaxIn] = useState(filters.maxPrice?.toString() ?? "");
  // Keep the custom inputs in sync when the price filter changes elsewhere (chips, "Clear all").
  const [syncedPrice, setSyncedPrice] = useState([filters.minPrice, filters.maxPrice]);
  if (syncedPrice[0] !== filters.minPrice || syncedPrice[1] !== filters.maxPrice) {
    setSyncedPrice([filters.minPrice, filters.maxPrice]);
    setMinIn(filters.minPrice?.toString() ?? "");
    setMaxIn(filters.maxPrice?.toString() ?? "");
  }

  const applyCustomPrice = () => {
    const min = minIn ? Math.max(0, Number(minIn)) : null;
    const max = maxIn ? Math.max(0, Number(maxIn)) : null;
    set({ minPrice: Number.isFinite(min) ? min : null, maxPrice: Number.isFinite(max) ? max : null });
  };

  return (
    <div className="divide-y divide-line">
      {!hideCategory && cats.length > 1 && (
        <Section title="Category" count={filters.categories.length}>
          <ul className="space-y-1">
            {cats.map((c) => (
              <li key={c.id}>
                <Checkbox
                  checked={filters.categories.includes(c.id)}
                  onChange={() => set({ categories: toggle(filters.categories, c.id) })}
                  label={c.name}
                  count={source.filter((p) => productInCategory(p, c.id)).length}
                />
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Price" count={filters.minPrice !== null || filters.maxPrice !== null ? 1 : 0}>
        <ul className="space-y-1">
          {PRICE_RANGES.map((r) => {
            const active = filters.minPrice === r.min && filters.maxPrice === r.max;
            return (
              <li key={r.label}>
                <Checkbox
                  type="radio"
                  name="price-range"
                  checked={active}
                  onChange={() => {
                    setMinIn(r.min?.toString() ?? "");
                    setMaxIn(r.max?.toString() ?? "");
                    set(active ? { minPrice: null, maxPrice: null } : { minPrice: r.min, maxPrice: r.max });
                  }}
                  label={r.label}
                />
              </li>
            );
          })}
        </ul>
        <form
          className="mt-3 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            applyCustomPrice();
          }}
        >
          <label className="flex-1 text-xs text-muted">
            Min ₹
            <input
              inputMode="numeric"
              value={minIn}
              onChange={(e) => setMinIn(e.target.value.replace(/\D/g, ""))}
              className="field-input mt-1 h-10 px-3 text-sm"
              placeholder="0"
            />
          </label>
          <label className="flex-1 text-xs text-muted">
            Max ₹
            <input
              inputMode="numeric"
              value={maxIn}
              onChange={(e) => setMaxIn(e.target.value.replace(/\D/g, ""))}
              className="field-input mt-1 h-10 px-3 text-sm"
              placeholder="5000"
            />
          </label>
          <button type="submit" className="h-10 rounded-xl border border-ink px-3 text-sm font-semibold hover:bg-ink hover:text-white">
            Go
          </button>
        </form>
      </Section>

      <Section title="Size" count={filters.sizes.length}>
        <div className="flex flex-wrap gap-2">
          {sizes.map((s) => {
            const active = filters.sizes.includes(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={active}
                onClick={() => set({ sizes: toggle<Size>(filters.sizes, s) })}
                className={cn(
                  "h-10 min-w-11 rounded-full border px-3 text-sm font-medium transition-colors",
                  active ? "border-ink bg-ink text-white" : "border-line hover:border-ink",
                )}
              >
                {s}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Colour" count={filters.colors.length}>
        <div className="grid grid-cols-2 gap-1">
          {colors.map((c) => {
            const active = filters.colors.includes(c.name);
            return (
              <button
                key={c.name}
                type="button"
                aria-pressed={active}
                onClick={() => set({ colors: toggle(filters.colors, c.name) })}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-sand",
                  active && "bg-sand font-medium",
                )}
              >
                <span
                  className={cn("h-5 w-5 shrink-0 rounded-full border", active ? "border-ink ring-2 ring-ink/20" : "border-black/15")}
                  style={{ backgroundColor: c.hex }}
                />
                <span className="truncate">{c.name}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Availability" count={filters.inStockOnly ? 1 : 0}>
        <Checkbox checked={filters.inStockOnly} onChange={() => set({ inStockOnly: !filters.inStockOnly })} label="In stock only" />
      </Section>

      <Section title="Discount" count={filters.minDiscount !== null ? 1 : 0}>
        <ul className="space-y-1">
          {DISCOUNT_OPTIONS.map((d) => (
            <li key={d}>
              <Checkbox
                type="radio"
                name="discount"
                checked={filters.minDiscount === d}
                onChange={() => set({ minDiscount: filters.minDiscount === d ? null : d })}
                label={`${d}% off or more`}
              />
            </li>
          ))}
        </ul>
      </Section>
      <p className="py-4 text-xs text-muted">
        Prices range from {formatPrice(Math.min(...source.map((p) => p.price)))} to{" "}
        {formatPrice(Math.max(...source.map((p) => p.price)))}
      </p>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="py-4">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left text-sm font-semibold"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span>
          {title}
          {count > 0 && <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent">{count}</span>}
        </span>
        <ChevronDown size={16} className={cn("text-muted transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pt-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Checkbox({
  checked,
  onChange,
  label,
  count,
  type = "checkbox",
  name,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  count?: number;
  type?: "checkbox" | "radio";
  name?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-1.5 text-sm hover:text-ink">
      {/* Single-choice groups (price, discount) still use checkboxes so a choice can be cleared by tapping it again. */}
      <input
        type="checkbox"
        name={name}
        data-group={type}
        checked={checked}
        onChange={onChange}
        className="h-[18px] w-[18px] shrink-0 accent-accent"
      />
      <span className={cn("flex-1", checked ? "font-medium text-ink" : "text-muted")}>{label}</span>
      {count !== undefined && <span className="text-xs text-muted">{count}</span>}
    </label>
  );
}
