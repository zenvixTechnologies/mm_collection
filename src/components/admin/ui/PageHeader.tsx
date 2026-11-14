import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface AdminCrumb {
  label: string;
  href?: string;
}

export function AdminBreadcrumbs({ items }: { items: AdminCrumb[] }) {
  const all: AdminCrumb[] = [{ label: "Dashboard", href: "/admin" }, ...items];
  return (
    <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
      <ol className="flex flex-wrap items-center gap-1">
        {all.map((c, i) => {
          const last = i === all.length - 1;
          return (
            <li key={`${c.label}-${i}`} className="flex items-center gap-1">
              {c.href && !last ? (
                <Link href={c.href} className="transition-colors hover:text-ink">
                  {c.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={last ? "text-ink" : undefined}>
                  {c.label}
                </span>
              )}
              {!last && <ChevronRight size={13} aria-hidden className="text-subtle" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Trail after "Dashboard". Omit on the dashboard itself. */
  breadcrumbs?: AdminCrumb[];
  eyebrow?: string;
  actions?: ReactNode;
  className?: string;
}

/** Title block at the top of every admin page: breadcrumbs, serif title, description, actions. */
export function PageHeader({ title, description, breadcrumbs, eyebrow, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("mb-6 flex flex-col gap-4 sm:mb-8 lg:flex-row lg:items-end lg:justify-between", className)}>
      <div className="min-w-0">
        {breadcrumbs && <AdminBreadcrumbs items={breadcrumbs} />}
        {eyebrow && <p className="eyebrow mt-3">{eyebrow}</p>}
        <h1 className={cn("font-display text-3xl font-semibold sm:text-4xl", (breadcrumbs || eyebrow) && "mt-2")}>{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted sm:text-[15px]">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:justify-end">{actions}</div>}
    </header>
  );
}
