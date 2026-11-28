import type { Product } from "@/types";

/**
 * Customer-facing policy copy shared by the policy pages, product page and FAQ,
 * so the wording and timelines stay identical everywhere they appear.
 */

export const UNDERGARMENT_RETURN_POLICY =
  "For hygiene and safety reasons, undergarments are non-returnable and non-exchangeable.";

/** From the Return & Refund Policy: returns within this many days of delivery… */
export const RETURN_WINDOW_DAYS = 7;
/** …and damaged or wrong items reported within this many hours. */
export const DAMAGE_CLAIM_HOURS = 48;

export type DeliveryZone = { region: string; minDays: number; maxDays: number };

export const DELIVERY_ZONES: DeliveryZone[] = [
  { region: "Within Kerala", minDays: 3, maxDays: 5 },
  { region: "South India", minDays: 5, maxDays: 7 },
  { region: "Rest of India", minDays: 7, maxDays: 10 },
];

export const DELIVERY_DISCLAIMER =
  "Delivery timelines are estimates and may vary depending on the delivery location and courier service.";

export function formatDeliveryZone(zone: DeliveryZone) {
  return `${zone.minDays}–${zone.maxDays} business days`;
}

/**
 * The catalogue has no dedicated undergarment category, so products are matched by
 * whole-word keywords in their name or sub-category. Add a category ID here if one is created.
 */
const UNDERGARMENT_CATEGORY_IDS: readonly string[] = [];
const UNDERGARMENT_PATTERN =
  /\b(undergarments?|underwear|inner ?wear|lingerie|bras?|bralettes?|panty|panties|briefs?|boxers?|trunks?|thongs?|shapewear)\b/i;

export function isUndergarment(product: Pick<Product, "name" | "categoryId">) {
  return UNDERGARMENT_CATEGORY_IDS.includes(product.categoryId) || UNDERGARMENT_PATTERN.test(product.name);
}

/** The policy excludes nightwear from returns; matched by category or by the word in the name. */
export function isNightwear(name: string, categorySlugs: string[]) {
  return categorySlugs.some((s) => /night-?wear|sleep-?wear/i.test(s)) || /\b(night ?wear|sleep ?wear|night ?suit|nighty|nightie|night ?dress|pyjamas?|pajamas?)\b/i.test(name);
}
