import type { Audience, Category, Product, ProductColor } from "@/types";
import { isAudience } from "@/data/audiences";
import { ALL_SIZES } from "./catalog-query";
import { isSortValue, type Filters, type SortValue } from "./catalog";

/**
 * The state of a product listing (Shop, a collection, a category…) and how it travels: page URL ⇄
 * state ⇄ GET /api/v1/products. Filtering, sorting and pagination happen on the server — nothing
 * here looks at products. Client-safe, and shared with the server so both read a URL the same way.
 */

export const PAGE_SIZE = 12;
/** Most "Load more" pages restored by opening one URL (8 × 12 fits the API's limit of 100). */
export const MAX_RESTORED_PAGES = 8;

/** What the page itself lists, before the shopper filters anything. */
export interface ListingScope {
  /** A collection or sub-category page belongs to one audience. */
  audience?: Audience;
  /** A sub-category page is locked to its category. */
  category?: string;
  newArrival?: boolean;
  bestSeller?: boolean;
  defaultSort: SortValue;
}

export interface ListingState {
  filters: Filters;
  search: string;
  sort: SortValue;
  /** How many pages are on screen. */
  page: number;
}

export interface ListingFacets {
  /** Audiences this listing has products for, whatever is filtered. */
  audiences: { id: Audience; count: number }[];
  /** Sub-categories within the chosen audience. */
  categories: { id: string; count: number }[];
  /** Sizes and colours with stock available within the chosen audience and categories. */
  sizes: string[];
  colors: ProductColor[];
  /** Whole-rupee price range within the chosen audience and categories. */
  price: { min: number; max: number } | null;
}

export interface ListingResult {
  items: Product[];
  total: number;
  facets: ListingFacets;
}

type Params = Pick<URLSearchParams, "get" | "getAll">;
type CategoryRef = Pick<Category, "id" | "audience">;

const OWN_PARAMS = ["for", "category", "sizes", "colors", "minPrice", "maxPrice", "inStock", "minDiscount", "search", "sort", "page"];

const list = (params: Params, key: string) => [
  ...new Set(
    params
      .getAll(key)
      .flatMap((v) => v.split(","))
      .map((v) => v.trim())
      .filter((v) => v && v.length <= 60),
  ),
];

function whole(value: string | null, min: number, max: number) {
  if (value === null || !/^\d{1,9}$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

/** A single letter isn't a search yet. */
export function searchText(value: string) {
  const text = value.trim().slice(0, 100);
  return text.length > 1 ? text : "";
}

/** Read a page URL. Anything unknown or malformed is ignored, never an error. */
export function parseListing(params: Params, scope: ListingScope, categories: CategoryRef[]): ListingState {
  const forParam = params.get("for");
  const audience = !scope.audience && isAudience(forParam) ? forParam : undefined;
  const within = scope.audience ?? audience;
  const picked = scope.category
    ? []
    : list(params, "category")
        .filter((id) => categories.some((c) => c.id === id && (!within || c.audience === within)))
        .slice(0, 30);
  const sizes = list(params, "sizes");
  const sort = params.get("sort");

  return {
    filters: {
      audiences: audience ? [audience] : [],
      categories: picked,
      sizes: ALL_SIZES.filter((s) => sizes.includes(s)),
      colors: list(params, "colors").slice(0, 30),
      minPrice: whole(params.get("minPrice"), 0, 10_000_000),
      maxPrice: whole(params.get("maxPrice"), 0, 10_000_000),
      inStockOnly: params.get("inStock") === "true",
      minDiscount: whole(params.get("minDiscount"), 1, 100),
    },
    search: searchText(params.get("search") ?? ""),
    sort: isSortValue(sort) ? sort : scope.defaultSort,
    page: whole(params.get("page"), 1, 10_000) ?? 1,
  };
}

/** A URL asking for more pages than one request restores is shown from the allowed maximum. */
export const restoredPages = (page: number) => Math.min(page, MAX_RESTORED_PAGES);

function setFilters(params: URLSearchParams, f: Filters, search: string) {
  if (f.sizes.length) params.set("sizes", f.sizes.join(","));
  if (f.colors.length) params.set("colors", f.colors.join(","));
  if (f.minPrice !== null) params.set("minPrice", String(f.minPrice));
  if (f.maxPrice !== null) params.set("maxPrice", String(f.maxPrice));
  if (f.inStockOnly) params.set("inStock", "true");
  if (f.minDiscount !== null) params.set("minDiscount", String(f.minDiscount));
  if (search) params.set("search", search);
}

/** The page URL's query string for a state. Parameters that aren't ours (utm_…) are kept. */
export function listingSearch(state: ListingState, scope: ListingScope, current = ""): string {
  const params = new URLSearchParams(current);
  OWN_PARAMS.forEach((k) => params.delete(k));
  const f = state.filters;
  if (!scope.audience && f.audiences.length === 1) params.set("for", f.audiences[0]);
  if (!scope.category && f.categories.length) params.set("category", f.categories.join(","));
  setFilters(params, f, state.search);
  if (state.sort !== scope.defaultSort) params.set("sort", state.sort);
  if (state.page > 1) params.set("page", String(state.page));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** Which products and order are wanted — everything about an API request except the page. */
export function listingQuery(state: ListingState, scope: ListingScope): string {
  const params = new URLSearchParams();
  const f = state.filters;
  const audience = scope.audience ?? f.audiences[0];
  if (audience) params.set("audience", audience);
  const category = scope.category ?? f.categories.join(",");
  if (category) params.set("category", category);
  if (scope.newArrival) params.set("newArrival", "true");
  if (scope.bestSeller) params.set("bestSeller", "true");
  setFilters(params, f, state.search);
  params.set("sort", state.sort);
  return params.toString();
}

export const withPage = (query: string, page: number, limit: number, facets: boolean) =>
  `${query}&page=${page}&limit=${limit}${facets ? "&facets=true" : ""}`;
