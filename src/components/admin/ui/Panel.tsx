import type { ReactNode } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface PanelProps {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Remove body padding (tables that run edge to edge). */
  flush?: boolean;
  id?: string;
}

/** The admin's basic surface: the storefront `.card` with a titled header. */
export function Panel({ title, description, action, children, className, flush, id }: PanelProps) {
  return (
    <section id={id} className={cn("card min-w-0 shadow-[0_1px_2px_rgb(42_15_17/0.04)]", className)} aria-label={typeof title === "string" ? title : undefined}>
      {(title || action) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </div>
      )}
      <div className={cn(!flush && "p-5")}>{children}</div>
    </section>
  );
}

interface StatCardProps {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  /** Percentage change vs previous period. */
  change?: number | null;
  hint?: string;
  /** For metrics where going down is good (e.g. failed payments). */
  invert?: boolean;
  tone?: "accent" | "gold" | "royal" | "success";
}

const ICON_TONE = {
  accent: "bg-accent-soft text-accent",
  gold: "bg-gold-soft text-gold-dark",
  royal: "bg-royal text-gold-light",
  success: "bg-success-soft text-success",
};

/** KPI tile: hero number, label, optional delta vs the previous period. */
export function StatCard({ label, value, icon, change, hint, invert, tone = "accent" }: StatCardProps) {
  const hasChange = change !== undefined && change !== null && Number.isFinite(change);
  const up = hasChange && change! >= 0;
  const good = hasChange && (invert ? !up : up);
  return (
    <div className="card relative overflow-hidden p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-muted">{label}</p>
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full sm:h-10 sm:w-10", ICON_TONE[tone])} aria-hidden>
          {icon}
        </span>
      </div>
      <p className="mt-1 font-display text-[26px] leading-none font-semibold tabular-nums sm:text-[32px]">{value}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {hasChange && (
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold", good ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
            {up ? <TrendingUp size={13} aria-hidden /> : <TrendingDown size={13} aria-hidden />}
            {up ? "+" : "−"}
            {Math.abs(change!).toFixed(1)}%
          </span>
        )}
        {hint && <span className="text-muted">{hint}</span>}
      </div>
      <div className="gold-rule absolute inset-x-5 bottom-0 opacity-50" aria-hidden />
    </div>
  );
}
