import Link from "next/link";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  children?: ReactNode;
}

export function EmptyState({ icon, title, description, actionLabel, actionHref, children }: EmptyStateProps) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16 text-center">
      <div className="relative mb-6 flex h-28 w-28 items-center justify-center rounded-full bg-sand text-accent">
        <span className="absolute -top-1 right-2 h-4 w-4 rounded-full bg-accent-soft" aria-hidden />
        <span className="absolute bottom-3 -left-1 h-3 w-3 rounded-full bg-line" aria-hidden />
        {icon}
      </div>
      <h2 className="font-display text-3xl font-semibold">{title}</h2>
      <p className="mt-2 text-muted">{description}</p>
      {actionLabel && actionHref && (
        <Link href={actionHref} className="btn-primary mt-7">
          {actionLabel}
        </Link>
      )}
      {children}
    </div>
  );
}
