import { DAMAGE_CLAIM_HOURS, RETURN_WINDOW_DAYS } from "@/lib/policies";
import type { StoreOrderStatus } from "@/types";

/** Order cancellation and return rules shared by the server, the order page and the admin panel. */

export const CANCEL_REASONS = {
  ordered_by_mistake: "Ordered by mistake",
  better_price: "Found a better price elsewhere",
  delivery_too_long: "Delivery is taking too long",
  changed_mind: "Changed my mind",
  not_needed: "Product no longer needed",
  wrong_item_ordered: "Ordered the wrong product / size / colour",
  other: "Other",
} as const;
export type CancelReason = keyof typeof CANCEL_REASONS;
export const CANCEL_REASON_KEYS = Object.keys(CANCEL_REASONS) as [CancelReason, ...CancelReason[]];

export const RETURN_REASONS = {
  damaged: "Received a damaged product",
  defective: "Received a defective product",
  wrong_product: "Wrong product received",
  wrong_size_colour: "Wrong size / colour received",
  not_as_described: "Product does not match the description",
  quality: "Quality issue",
  other: "Other",
} as const;
export type ReturnReason = keyof typeof RETURN_REASONS;
export const RETURN_REASON_KEYS = Object.keys(RETURN_REASONS) as [ReturnReason, ...ReturnReason[]];

/** The reasons that fall under the policy's "damaged or wrong item" section. */
export const DAMAGED_OR_INCORRECT: ReturnReason[] = ["damaged", "wrong_product", "wrong_size_colour"];

export const RETURN_STATUSES = {
  requested: "Return Requested",
  approved: "Return Approved",
  rejected: "Return Rejected",
  processing: "Return Processing",
  completed: "Return Completed",
} as const;
export type ReturnStatus = keyof typeof RETURN_STATUSES;
export const RETURN_STATUS_KEYS = Object.keys(RETURN_STATUSES) as [ReturnStatus, ...ReturnStatus[]];

/** Allowed moves. Rejected and completed are final. */
export const RETURN_NEXT: Record<ReturnStatus, ReturnStatus[]> = {
  requested: ["approved", "rejected"],
  approved: ["processing", "rejected"],
  // The item can still be refused after the quality check.
  processing: ["completed", "rejected"],
  rejected: [],
  completed: [],
};

/** The cancel button: enabled before shipping, shown disabled once on its way, otherwise absent. */
export function cancelAction(status: StoreOrderStatus): "on" | "off" | "hidden" {
  if (status === "Order Placed" || status === "Confirmed" || status === "Processing" || status === "Packed") return "on";
  return status === "Shipped" || status === "Out for Delivery" ? "off" : "hidden";
}

export type NonReturnable = "undergarment" | "nightwear" | null;

/**
 * Which reasons a customer may submit for an item, from the Return Policy: nothing after the
 * return window; undergarments and nightwear only as damaged or wrong items, within the policy's
 * 48 hours. Everything else is reviewed by staff, who approve or reject each request.
 */
export function returnRules(nonReturnable: NonReturnable, deliveredAt: Date | null, now: Date): { reasons: ReturnReason[]; message: string | null } {
  if (!deliveredAt) return { reasons: [], message: "We couldn't confirm when this order was delivered. Please contact us about a return." };
  const age = now.getTime() - deliveredAt.getTime();
  if (age > RETURN_WINDOW_DAYS * 86_400_000) return { reasons: [], message: `The ${RETURN_WINDOW_DAYS}-day return window has closed.` };
  if (!nonReturnable) return { reasons: [...RETURN_REASON_KEYS], message: null };
  const what = nonReturnable === "undergarment" ? "Undergarments" : "Nightwear";
  return age <= DAMAGE_CLAIM_HOURS * 3_600_000
    ? { reasons: [...DAMAGED_OR_INCORRECT], message: `${what} can't be returned. You can only report a damaged or wrong item, within ${DAMAGE_CLAIM_HOURS} hours of delivery.` }
    : { reasons: [], message: `${what} can't be returned, and the ${DAMAGE_CLAIM_HOURS}-hour period for reporting a damaged or wrong item has passed.` };
}
