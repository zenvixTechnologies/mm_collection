"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Provide to make the column sortable. */
  sortValue?: (row: T) => string | number;
  align?: "left" | "right" | "center";
  /** Hide on narrow screens to keep the key columns readable. */
  hideBelow?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

export interface SortState {
  id: string;
  dir: "asc" | "desc";
}

interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  getRowId: (row: T) => string;
  /** Visually hidden table caption for screen readers. */
  caption: string;
  pageSize?: number;
  initialSort?: SortState;
  selectable?: boolean;
  selected?: string[];
  onSelectedChange?: (ids: string[]) => void;
  /** Rendered in a bar above the table while rows are selected. */
  bulkActions?: (ids: string[]) => ReactNode;
  empty?: ReactNode;
  rowClassName?: (row: T) => string | undefined;
  /** Change this (e.g. to the current search + filters) to jump back to page 1. */
  resetKey?: string;
}

const HIDE: Record<NonNullable<Column<unknown>["hideBelow"]>, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};

const ALIGN = { left: "text-left", right: "text-right", center: "text-center" };

export function DataTable<T>({
  rows,
  columns,
  getRowId,
  caption,
  pageSize = 10,
  initialSort,
  selectable,
  selected = [],
  onSelectedChange,
  bulkActions,
  empty,
  rowClassName,
  resetKey,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState | undefined>(initialSort);
  const [page, setPage] = useState(0);
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey);
    setPage(0);
  }

  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.id === sort.id);
    if (!sort || !col?.sortValue) return rows;
    const get = col.sortValue;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "en-IN", { numeric: true }) * dir;
    });
  }, [rows, columns, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  const visible = sorted.slice(current * pageSize, current * pageSize + pageSize);
  const visibleIds = visible.map(getRowId);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));
  const someVisibleSelected = visibleIds.some((id) => selected.includes(id));

  const toggleSort = (id: string) =>
    setSort((s) => (s?.id === id ? { id, dir: s.dir === "asc" ? "desc" : "asc" } : { id, dir: "desc" }));

  const toggleRow = (id: string) =>
    onSelectedChange?.(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const toggleAllVisible = () =>
    onSelectedChange?.(
      allVisibleSelected ? selected.filter((id) => !visibleIds.includes(id)) : Array.from(new Set([...selected, ...visibleIds])),
    );

  return (
    <div className="min-w-0">
      {selectable && selected.length > 0 && bulkActions && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-gold-soft/70 px-4 py-2.5 text-sm">
          <span className="mr-auto font-semibold">
            {selected.length} selected
            <button type="button" onClick={() => onSelectedChange?.([])} className="ml-3 text-xs font-medium text-muted underline-offset-2 hover:text-ink hover:underline">
              Clear
            </button>
          </span>
          {bulkActions(selected)}
        </div>
      )}

      <div className="relative overflow-x-auto">
        <table className="w-full min-w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line bg-canvas/80">
              {selectable && (
                <th scope="col" className="w-10 py-3 pr-1 pl-4">
                  <input
                    type="checkbox"
                    aria-label="Select all rows on this page"
                    checked={allVisibleSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected;
                    }}
                    onChange={toggleAllVisible}
                    className="h-4 w-4"
                  />
                </th>
              )}
              {columns.map((c) => {
                const active = sort?.id === c.id;
                return (
                  <th
                    key={c.id}
                    scope="col"
                    aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                    className={cn(
                      "px-4 py-3 text-[11.5px] font-semibold tracking-[0.08em] whitespace-nowrap text-muted uppercase",
                      ALIGN[c.align ?? "left"],
                      c.hideBelow && HIDE[c.hideBelow],
                    )}
                  >
                    {c.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.id)}
                        className={cn("inline-flex items-center gap-1 uppercase hover:text-ink", active && "text-ink", c.align === "right" && "flex-row-reverse")}
                      >
                        {c.header}
                        {active ? (
                          sort!.dir === "asc" ? <ArrowUp size={13} aria-hidden /> : <ArrowDown size={13} aria-hidden />
                        ) : (
                          <ArrowUpDown size={12} className="opacity-50" aria-hidden />
                        )}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {visible.map((row) => {
              const id = getRowId(row);
              const isSelected = selected.includes(id);
              return (
                <tr key={id} className={cn("transition-colors hover:bg-canvas/70", isSelected && "bg-gold-soft/40", rowClassName?.(row))}>
                  {selectable && (
                    <td className="w-10 py-3 pr-1 pl-4 align-middle">
                      <input type="checkbox" aria-label={`Select row ${id}`} checked={isSelected} onChange={() => toggleRow(id)} className="h-4 w-4" />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td key={c.id} className={cn("px-4 py-3 align-middle", ALIGN[c.align ?? "left"], c.hideBelow && HIDE[c.hideBelow], c.className)}>
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <div className="px-4 py-14 text-center">{empty ?? <p className="text-sm text-muted">Nothing to show.</p>}</div>}
      </div>

      {sorted.length > pageSize && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-[13px] text-muted">
          <p>
            Showing <span className="font-semibold text-ink tabular-nums">{current * pageSize + 1}</span>–
            <span className="font-semibold text-ink tabular-nums">{Math.min(sorted.length, (current + 1) * pageSize)}</span> of{" "}
            <span className="font-semibold text-ink tabular-nums">{sorted.length}</span>
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage(current - 1)}
              disabled={current === 0}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-white text-ink transition-colors hover:bg-sand disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Previous page"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="px-2 tabular-nums">
              Page {current + 1} of {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage(current + 1)}
              disabled={current >= pageCount - 1}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-white text-ink transition-colors hover:bg-sand disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Small empty-state used inside tables and panels. */
export function TableEmpty({ icon, title, description, action }: { icon: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center">
      <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-sand text-accent" aria-hidden>
        {icon}
      </span>
      <p className="font-display text-xl font-semibold">{title}</p>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
