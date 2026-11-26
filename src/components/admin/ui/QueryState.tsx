"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import { TableEmpty } from "./DataTable";

/** Error state with a retry button, for admin screens that load from the API. */
export function LoadError({ message, onRetry, title = "Couldn't load this" }: { message: string | null; onRetry: () => void; title?: string }) {
  return (
    <div className="px-4 py-14" role="alert">
      <TableEmpty
        icon={<AlertTriangle size={24} />}
        title={title}
        description={message ?? "Please try again."}
        action={
          <button type="button" onClick={onRetry} className="btn-dark btn-sm">
            <RotateCw size={15} aria-hidden /> Try again
          </button>
        }
      />
    </div>
  );
}

/** Placeholder rows while an admin list loads for the first time. */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-11 rounded-lg" />
      ))}
    </div>
  );
}
