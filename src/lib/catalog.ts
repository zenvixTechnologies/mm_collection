import type { Audience, Category, Product, Size } from "@/types";
import { AUDIENCES } from "@/data/audiences";
import { categoryFullName } from "./catalog-query";

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
  /** Women / Men / Kids / Home & Living — only offered where a listing mixes audiences (Shop All, New Arrivals…). */
  audiences: Audience[];
  categories: string[];
  sizes: Size[];
  colors: string[];
  minPrice: number | null;
  maxPrice: number | null;
  inStockOnly: boolean;
  minDiscount: number | null;
}

export const EMPTY_FILTERS: Filters = {
  audiences: [],
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
    f.audiences.length +
    f.categories.length +
    f.sizes.length +
    f.colors.length +
    (f.minPrice !== null || f.maxPrice !== null ? 1 : 0) +
    (f.inStockOnly ? 1 : 0) +
    (f.minDiscount !== null ? 1 : 0)
  );
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

/** The words of a search. Single letters are noise — "men's" normalises to "men s". */
export function searchTerms(query: string) {
  return normalize(query)
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** Simple singularisation: "kurtis" → "kurti", "dresses" → "dress". */
export const searchStem = (term: string) => term.replace(/(es|s)$/, "");

/** Lightweight keyword search across name, category, colours, fabric and description. */
export function searchProducts(query: string, source: Product[], categories: Category[]) {
  const terms = searchTerms(query);
  if (!terms.length) return [];
  const catName = (id: string) => {
    const c = categories.find((x) => x.id === id);
    return c ? categoryFullName(c) : id;
  };
  const audienceWords = (a: Audience) => AUDIENCES.find((x) => x.id === a)?.keywords.join(" ") ?? a;
  const words = (s: string) => normalize(s).split(/\s+/).filter(Boolean);
  // Match on word starts, not substrings, so "men" never matches "women" or "moment".
  const hits = (list: string[], t: string, stem: string) =>
    list.some((w) => w.startsWith(t) || (stem.length > 2 && w.startsWith(stem)));

  return source
    .map((p) => {
      const name = words(p.name);
      const haystack = words(
        [
          p.name,
          audienceWords(p.audienceCategory),
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
        const stem = searchStem(t);
        if (hits(name, t, stem)) score += 3;
        else if (hits(haystack, t, stem)) score += 1;
        else return { p, score: 0 };
      }
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.p.sold - a.p.sold)
    .map((x) => x.p);
}

/**
 * Categories whose name (or main category, e.g. "home", "bedding", "kids") matches every search term —
 * lets search lead shoppers to a category even before it has products.
 */
export function searchCategories(query: string, categories: Category[], limit = 4): Category[] {
  const terms = normalize(query)
    .split(/\s+/)
    .filter((t) => t.length > 1);
  if (!terms.length) return [];
  return categories
    .filter((c) => {
      const info = AUDIENCES.find((a) => a.id === c.audience);
      const words = normalize([categoryFullName(c), info?.label ?? "", ...(info?.keywords ?? [])].join(" "))
        .split(/\s+/)
        .filter(Boolean);
      return terms.every((t) => {
        const stem = t.replace(/(es|s)$/, "");
        return words.some((w) => w.startsWith(t) || (stem.length > 2 && w.startsWith(stem)));
      });
    })
    .slice(0, limit);
}

export const POPULAR_SEARCHES: Record<Audience, string[]> = {
  women: ["Kurti", "Maxi dress", "Co-ord set", "Saree", "Feeding", "Party gown"],
  men: ["Shirt", "Jeans", "Kurta", "T-shirt", "Suit", "Chinos"],
  kids: ["Frock", "Kurta", "Baby", "Polo", "Party dress", "Dungaree"],
  "home-living": ["Bedsheet", "Pillow cover", "Cushion cover", "Blanket"],
};
