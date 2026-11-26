import type { OrderStatus, StoreOrder } from "@/types";
import { ORDER_STATUSES } from "@/types";
import type { AdminOrder, AdminOrderStatus } from "@/types/admin";

/** Every status an admin can filter by, in lifecycle order. */
export const ADMIN_ORDER_STATUSES: AdminOrderStatus[] = ["Payment Pending", ...ORDER_STATUSES, "Cancelled", "Payment Failed", "Expired"];

/**
 * View an admin order through the storefront's order type so the existing order components
 * (OrderItems, OrderTotals, OrderTimeline, AddressBlock) can be reused as-is.
 * A cancelled order is shown at the last delivery status it actually reached.
 */
export function toStoreOrder(o: AdminOrder): StoreOrder {
  const reached = ORDER_STATUSES.filter((s) => o.history[s]);
  const status = o.status === "Cancelled" && reached.length ? reached[reached.length - 1] : o.status;
  const history: StoreOrder["history"] = {};
  for (const [s, at] of Object.entries(o.history)) if (at) history[s as AdminOrderStatus] = at;
  return { ...o, status, history };
}

/**
 * Fulfilment steps an admin may move a paid order to (forward only; cancel before it ships).
 * The server enforces the same rules — this only decides what the UI offers. Unpaid, failed and
 * expired orders have no admin transitions except cancelling an unpaid one.
 */
export function nextStatuses(status: AdminOrderStatus): AdminOrderStatus[] {
  if (status === "Payment Pending") return ["Cancelled"];
  const i = ORDER_STATUSES.indexOf(status as OrderStatus);
  if (i < 0 || status === "Delivered") return [];
  const forward = ORDER_STATUSES.slice(i + 1);
  return i < ORDER_STATUSES.indexOf("Shipped") ? [...forward, "Cancelled"] : forward;
}

export const PAYMENT_METHOD_LABEL = { upi: "UPI", card: "Card", netbanking: "Net banking", cod: "Cash on delivery" } as const;
