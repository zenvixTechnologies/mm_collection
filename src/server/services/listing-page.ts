import "server-only";
import { redirect } from "next/navigation";
import {
  PAGE_SIZE,
  listingQuery,
  listingSearch,
  parseListing,
  restoredPages,
  withPage,
  type ListingResult,
  type ListingScope,
} from "@/lib/listing";
import { getCatalog, listProducts } from "@/server/services/catalog.service";
import { productListQuery } from "@/server/validation/catalog";

export type SearchParams = Record<string, string | string[] | undefined>;

/** The first screen of a listing page, kept with the request it answers. */
export interface InitialListing extends ListingResult {
  query: string;
  pages: number;
  fetchedAt: number;
}

function toURLSearchParams(searchParams: SearchParams) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, v);
  }
  return params;
}

/**
 * Server render of a listing page: the same query the browser sends to /api/v1/products, read
 * fresh from MongoDB. Redirects where the URL and the filters on screen would otherwise disagree.
 */
export async function loadListing(path: string, scope: ListingScope, searchParams: SearchParams): Promise<InitialListing> {
  const { categories } = await getCatalog();
  const params = toURLSearchParams(searchParams);
  const state = parseListing(params, scope, categories);
  const query = listingQuery(state, scope);
  const pages = restoredPages(state.page);
  const request = Object.fromEntries(new URLSearchParams(withPage(query, 1, PAGE_SIZE * pages, true)));
  const { items, meta, facets } = await listProducts(productListQuery.parse(request));

  if (!scope.audience && !scope.category) {
    const has = (a: string) => facets!.audiences.some((x) => x.id === a);
    const [audience] = state.filters.audiences;
    // ?for= is only honoured for an audience this listing has (there may be no Home & Living new arrivals).
    if (audience && !has(audience)) {
      redirect(path + listingSearch({ ...state, filters: { ...state.filters, audiences: [] } }, scope, params.toString()));
    }
    // A link to one sub-category also opens its audience.
    const only = state.filters.categories.length === 1 ? categories.find((c) => c.id === state.filters.categories[0]) : undefined;
    if (!audience && only && has(only.audience)) {
      redirect(path + listingSearch({ ...state, filters: { ...state.filters, audiences: [only.audience] } }, scope, params.toString()));
    }
  }

  return { query, pages, items, total: meta.total, facets: facets!, fetchedAt: Date.now() };
}
