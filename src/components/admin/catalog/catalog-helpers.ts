import type { Audience, Size } from "@/types";
import { AUDIENCES } from "@/data/audiences";

/** Same rule as the storefront — "Men's Shirts", "Kids' T-Shirts", "Dresses", "Bedsheets". */
export { categoryFullName as categoryLabel } from "@/data/categories";

export const SIZE_OPTIONS: Record<Audience, Size[]> = {
  women: ["XS", "S", "M", "L", "XL", "XXL", "Free Size"],
  men: ["S", "M", "L", "XL", "XXL", "28", "30", "32", "34", "36"],
  kids: ["0-6M", "6-12M", "1-2Y", "3-4Y", "5-6Y", "7-8Y", "9-10Y"],
  "home-living": ["Single", "Double", "Queen", "King", "Standard", "16 × 16 in", "18 × 18 in", "24 × 24 in", "Free Size"],
};

/** Main categories (Women / Men / Kids / Home & Living), straight from the storefront's registry. */
export const AUDIENCE_OPTIONS: { value: Audience; label: string }[] = AUDIENCES.map((a) => ({ value: a.id, label: a.label }));

export function audienceLabel(audience: Audience) {
  return AUDIENCES.find((a) => a.id === audience)?.label ?? audience;
}
