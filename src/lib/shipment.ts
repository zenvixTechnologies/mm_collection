import type { StoreOrderStatus } from "@/types";
import { ORDER_STATUSES } from "@/types";

/**
 * The steps of the progress timeline. "Packed" is optional, so it only appears for orders that
 * went through it — orders that never did look exactly as they always have.
 */
export function timelineSteps(order: { status: StoreOrderStatus; history: Partial<Record<StoreOrderStatus, string>> }): StoreOrderStatus[] {
  const steps: StoreOrderStatus[] = [...ORDER_STATUSES];
  if (order.status === "Packed" || order.history.Packed) steps.splice(steps.indexOf("Shipped"), 0, "Packed");
  return steps;
}
