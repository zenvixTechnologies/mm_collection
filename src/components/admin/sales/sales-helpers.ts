import type { Order } from "@/types";
import { ORDER_STATUSES } from "@/types";
import type { AdminOrder, AdminOrderStatus } from "@/types/admin";

export const ADMIN_ORDER_STATUSES: AdminOrderStatus[] = [...ORDER_STATUSES, "Cancelled"];

/**
 * View an admin order through the storefront's Order type so the existing order components
 * (OrderItems, OrderTotals, OrderTimeline, AddressBlock) can be reused as-is.
 * A cancelled order is shown at the last status it actually reached.
 */
export function toStoreOrder(o: AdminOrder): Order {
  const reached = ORDER_STATUSES.filter((s) => o.history[s]);
  const status = o.status === "Cancelled" ? (reached[reached.length - 1] ?? "Order Placed") : o.status;
  const history: Order["history"] = {};
  for (const s of ORDER_STATUSES) if (o.history[s]) history[s] = o.history[s];
  return { ...o, status, history };
}

/** Statuses an order can move to next (forward only, or cancel before it ships). */
export function nextStatuses(status: AdminOrderStatus): AdminOrderStatus[] {
  if (status === "Cancelled" || status === "Delivered") return [];
  const i = ORDER_STATUSES.indexOf(status);
  const forward = ORDER_STATUSES.slice(i + 1);
  return i < ORDER_STATUSES.indexOf("Shipped") ? [...forward, "Cancelled"] : forward;
}

export const PAYMENT_METHOD_LABEL = { upi: "UPI", card: "Card", netbanking: "Net banking", cod: "Cash on delivery" } as const;
