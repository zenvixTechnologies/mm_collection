"use client";

import Link from "next/link";
import type { AdminPage, AdminReturnRequest } from "@/types/admin";
import { useAdminQuery } from "@/hooks/use-admin-query";
import { useAdminSession } from "@/store/admin-store";
import { Panel } from "../ui/Panel";

/** This order's return requests, for staff who may manage them. Nothing is shown if there are none. */
export function OrderReturnsPanel({ orderId }: { orderId: string }) {
  const allowed = useAdminSession((s) => s.can("payments:refund"));
  const { data } = useAdminQuery<AdminPage<AdminReturnRequest>>(allowed ? `/returns?order=${orderId}&limit=50` : null);
  if (!data?.items.length) return null;
  return (
    <Panel
      className="mb-6"
      title="Return requests"
      action={
        <Link href="/mm-hub/returns" className="text-[13px] font-semibold text-accent hover:underline">
          Manage returns
        </Link>
      }
    >
      <ul className="space-y-2 text-sm">
        {data.items.map((r) => (
          <li key={r.id} className="break-words">
            <strong>{r.statusLabel}</strong> · {r.name}
            {r.size && ` (${r.size})`} × {r.quantity} · {r.reason}
            {r.explanation && ` — ${r.explanation}`}
            {r.comments && <span className="text-muted"> · {r.comments}</span>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
