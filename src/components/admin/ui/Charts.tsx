"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Lightweight SVG charts in the brand palette — no chart library.
 * Single series only (the title names it, so no legend); thin marks, recessive grid,
 * hover/keyboard crosshair with a tooltip, and a screen-reader table of the values.
 */

export interface ChartPoint {
  key: string;
  /** Full label for the tooltip, e.g. "Thu, 13 Nov". */
  label: string;
  /** Short axis label, e.g. "13 Nov". */
  tick: string;
  value: number;
}

const M = { top: 14, right: 12, bottom: 28, left: 56 };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * pow;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Column with only its top corners rounded (4px), anchored on the baseline. */
function columnPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  if (h <= 0) return "";
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

interface TrendChartProps {
  data: ChartPoint[];
  kind: "area" | "bar";
  /** Formats values in the tooltip. */
  format: (v: number) => string;
  /** Formats y-axis ticks (usually compact). */
  axisFormat: (v: number) => string;
  /** Accessible name, e.g. "Daily revenue, last 30 days". */
  label: string;
  height?: number;
  valueName: string;
}

export function TrendChart({ data, kind, format, axisFormat, label, height = 260, valueName }: TrendChartProps) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const gradientId = `g${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  const geo = useMemo(() => {
    const w = Math.max(0, width - M.left - M.right);
    const h = height - M.top - M.bottom;
    const max = niceMax(Math.max(...data.map((d) => d.value), 0));
    const n = data.length;
    const band = n ? w / n : 0;
    const x = (i: number) => (kind === "bar" ? M.left + band * i + band / 2 : M.left + (n > 1 ? (w * i) / (n - 1) : w / 2));
    const y = (v: number) => M.top + h - (v / max) * h;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 72))));
    return { w, h, max, band, x, y, ticks, every, n };
  }, [width, height, data, kind]);

  const line = data.map((d, i) => `${i ? "L" : "M"}${geo.x(i)},${geo.y(d.value)}`).join("");
  const area = data.length ? `${line}L${geo.x(data.length - 1)},${M.top + geo.h}L${geo.x(0)},${M.top + geo.h}Z` : "";

  const pick = (clientX: number, rect: DOMRect) => {
    const px = clientX - rect.left - M.left;
    const i = kind === "bar" ? Math.floor(px / geo.band) : Math.round((px / Math.max(1, geo.w)) * (geo.n - 1));
    setActive(Math.max(0, Math.min(geo.n - 1, i)));
  };

  const a = active !== null ? data[active] : null;
  const tipLeft = a ? Math.min(Math.max(geo.x(active!), 80), Math.max(80, width - 80)) : 0;

  return (
    <div ref={wrapRef} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          tabIndex={0}
          className="block touch-pan-y outline-none focus-visible:rounded-lg focus-visible:ring-2 focus-visible:ring-accent/40"
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") setActive((i) => Math.min(geo.n - 1, (i ?? -1) + 1));
            else if (e.key === "ArrowLeft") setActive((i) => Math.max(0, (i ?? geo.n) - 1));
            else if (e.key === "Escape") setActive(null);
            else return;
            e.preventDefault();
          }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.16" />
              <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* grid + y axis */}
          {geo.ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={M.left + geo.w} y1={geo.y(t)} y2={geo.y(t)} stroke="var(--color-line)" strokeDasharray={t === 0 ? undefined : "3 4"} />
              <text x={M.left - 10} y={geo.y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                {axisFormat(t)}
              </text>
            </g>
          ))}

          {/* x axis ticks */}
          {/* x-axis ticks, counted back from today so the latest day is always labelled */}
          {data.map((d, i) =>
            (data.length - 1 - i) % geo.every === 0 ? (
              <text
                key={d.key}
                x={geo.x(i)}
                y={height - 8}
                textAnchor={kind === "area" && i === data.length - 1 ? "end" : kind === "area" && i === 0 ? "start" : "middle"}
                className="fill-muted text-[11px]"
              >
                {d.tick}
              </text>
            ) : null,
          )}

          {kind === "area" ? (
            <>
              <path d={area} fill={`url(#${gradientId})`} />
              <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            </>
          ) : (
            data.map((d, i) => {
              const bw = Math.max(2, Math.min(28, geo.band - 2));
              const top = geo.y(d.value);
              return (
                <path
                  key={d.key}
                  d={columnPath(geo.x(i) - bw / 2, top, bw, M.top + geo.h - top)}
                  className={cn("transition-opacity", active !== null && active !== i ? "fill-gold/55" : "fill-gold")}
                />
              );
            })
          )}

          {a && (
            <g pointerEvents="none">
              <line x1={geo.x(active!)} x2={geo.x(active!)} y1={M.top} y2={M.top + geo.h} stroke="var(--color-ink)" strokeOpacity={0.25} />
              {kind === "area" && <circle cx={geo.x(active!)} cy={geo.y(a.value)} r={5} fill="var(--color-accent)" stroke="white" strokeWidth={2} />}
            </g>
          )}
        </svg>
      )}

      {a && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-xl border border-line bg-white px-3 py-2 text-xs shadow-[var(--shadow-pop)]"
          style={{ left: tipLeft }}
          role="status"
        >
          <p className="font-medium whitespace-nowrap text-muted">{a.label}</p>
          <p className="mt-0.5 text-sm font-semibold whitespace-nowrap text-ink tabular-nums">
            {format(a.value)} <span className="font-normal text-muted">{valueName}</span>
          </p>
        </div>
      )}

      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.key}>
              <th scope="row">{d.label}</th>
              <td>{format(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface BarListItem {
  key: string;
  label: ReactNode;
  value: number;
  display: string;
  hint?: string;
}

/** Ranked horizontal bars with the value written out — one hue, labels in text colours. */
export function BarList({ items, label, tone = "accent" }: { items: BarListItem[]; label: string; tone?: "accent" | "gold" }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul aria-label={label} className="space-y-3.5">
      {items.map((it) => (
        <li key={it.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium text-ink">{it.label}</span>
            <span className="shrink-0 font-semibold text-ink tabular-nums">
              {it.display}
              {it.hint && <span className="ml-1.5 text-xs font-normal text-muted">{it.hint}</span>}
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-sand" aria-hidden>
            <div
              className={cn("h-full rounded-full", tone === "accent" ? "bg-accent" : "bg-gradient-to-r from-gold-dark to-gold")}
              style={{ width: `${Math.max(2, (it.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
