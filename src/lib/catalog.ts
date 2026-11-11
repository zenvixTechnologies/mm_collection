import type { Product, Size } from "@/types";
import { categories } from "@/data/categories";
import { productInCategory, products } from "@/data/products";

export const SORT_OPTIONS = [
  { value: "featured", label: "Featured" },
  { value: "newest", label: "Newest" },
  { value: "price-asc", label: "Price: Low to High" },
  { value: "price-desc", label: "Price: High to Low" },
  { value: "best-selling", label: "Best Selling" },
  { value: "rating", label: "Highest Rated" },
] as const;

export type SortValue = (typeof SORT_OPTIONS)[number]["value"];

export function isSortValue(v: unknown): v is SortValue {
  return SORT_OPTIONS.some((o) => o.value === v);
}

export const DISCOUNT_OPTIONS = [10, 20, 30, 40] as const;

export interface Filters {
  categories: string[];
  sizes: Size[];
  colors: string[];
  minPrice: number | null;
  maxPrice: number | null;
  inStockOnly: boolean;
  minDiscount: number | null;
}

export const EMPTY_FILTERS: Filters = {
  categories: [],
  sizes: [],
  colors: [],
  minPrice: null,
  maxPrice: null,
  inStockOnly: false,
  minDiscount: null,
};

export function countActiveFilters(f: Filters) {
  return (
    f.categories.length +
    f.sizes.length +
    f.colors.length +
    (f.minPrice !== null || f.maxPrice !== null ? 1 : 0) +
    (f.inStockOnly ? 1 : 0) +
    (f.minDiscount !== null ? 1 : 0)
  );
}

export function applyFilters(list: Product[], f: Filters) {
  return list.filter((p) => {
    if (f.categories.length && !f.categories.some((c) => productInCategory(p, c))) return false;
    if (f.sizes.length && !f.sizes.some((s) => p.sizes.includes(s))) return false;
    if (f.colors.length && !p.colors.some((c) => f.colors.includes(c.name))) return false;
    if (f.minPrice !== null && p.price < f.minPrice) return false;
    if (f.maxPrice !== null && p.price > f.maxPrice) return false;
    if (f.inStockOnly && p.stock <= 0) return false;
    if (f.minDiscount !== null && p.discount < f.minDiscount) return false;
    return true;
  });
}

export function sortProducts(list: Product[], sort: SortValue) {
  // Sold-out items always sink to the end, whatever the chosen order.
  const sorted = sortBy([...list], sort);
  return [...sorted.filter((p) => p.stock > 0), ...sorted.filter((p) => p.stock <= 0)];
}

function sortBy(copy: Product[], sort: SortValue) {
  switch (sort) {
    case "newest":
      return copy.sort((a, b) => Number(b.newArrival) - Number(a.newArrival) || b.addedAt - a.addedAt);
    case "price-asc":
      return copy.sort((a, b) => a.price - b.price);
    case "price-desc":
      return copy.sort((a, b) => b.price - a.price);
    case "best-selling":
      return copy.sort((a, b) => b.sold - a.sold);
    case "rating":
      return copy.sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount);
    case "featured":
    default:
      // Featured first, then in-stock before sold-out, then popularity.
      return copy.sort(
        (a, b) =>
          Number(b.featured) - Number(a.featured) ||
          Number(b.stock > 0) - Number(a.stock > 0) ||
          b.sold - a.sold,
      );
  }
}

function normalize(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ");
}

/** Lightweight keyword search across name, category, colours, fabric and description. */
export function searchProducts(query: string, source: Product[] = products) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? id;

  return source
    .map((p) => {
      const name = normalize(p.name);
      const haystack = normalize(
        [
          p.name,
          catName(p.categoryId),
          ...p.tags.map(catName),
          ...p.colors.map((c) => c.name),
          p.fabric,
          p.shortDescription,
          p.sku,
        ].join(" "),
      );
      let score = 0;
      for (const t of terms) {
        // simple singularisation: "kurtis" → "kurti", "dresses" → "dress"
        const stem = t.replace(/(es|s)$/, "");
        if (name.includes(t) || name.includes(stem)) score += 3;
        else if (haystack.includes(t) || (stem.length > 2 && haystack.includes(stem))) score += 1;
        else return { p, score: 0 };
      }
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.p.sold - a.p.sold)
    .map((x) => x.p);
}

export const POPULAR_SEARCHES = ["Kurti", "Maxi dress", "Co-ord set", "Saree", "Feeding", "Party gown"];
