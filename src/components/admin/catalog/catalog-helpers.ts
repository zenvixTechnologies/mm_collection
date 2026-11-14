import type { Audience, Size } from "@/types";
import type { AdminCategory } from "@/types/admin";

/** Same rule as the storefront's categoryFullName: "Men's Shirts", "Kids' T-Shirts", "Dresses". */
export function categoryLabel(c: Pick<AdminCategory, "audience" | "name">) {
  if (c.audience === "women" || /^(men|kids)/i.test(c.name)) return c.name;
  return `${c.audience === "men" ? "Men's" : "Kids'"} ${c.name}`;
}

export const SIZE_OPTIONS: Record<Audience, Size[]> = {
  women: ["XS", "S", "M", "L", "XL", "XXL", "Free Size"],
  men: ["S", "M", "L", "XL", "XXL", "28", "30", "32", "34", "36"],
  kids: ["0-6M", "6-12M", "1-2Y", "3-4Y", "5-6Y", "7-8Y", "9-10Y"],
};

export const AUDIENCE_OPTIONS: { value: Audience; label: string }[] = [
  { value: "women", label: "Women" },
  { value: "men", label: "Men" },
  { value: "kids", label: "Kids" },
];
