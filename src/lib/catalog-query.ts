import type { Audience, Category, Product, ProductColor, Size } from "@/types";

/**
 * Catalogue lookups over a snapshot loaded from MongoDB. Same helpers the storefront used
 * against the static data files, so components keep their logic — only the source changed.
 * Client-safe: no server imports.
 */

export interface CatalogSnapshot {
  products: Product[];
  categories: Category[];
}

/**
 * Name that stays unambiguous outside its audience — "Men's Shirts", "Kids' T-Shirts", "Dresses", "Bedsheets".
 * Shared with the admin, whose categories use the same audience + name shape.
 */
export function categoryFullName(c: Pick<Category, "audience" | "name">) {
  if (c.audience === "women" || c.audience === "home-living" || /^(men|kids)/i.test(c.name)) return c.name;
  return `${c.audience === "men" ? "Men's" : "Kids'"} ${c.name}`;
}

export function productInCategory(product: Product, categoryId: string) {
  return product.categoryId === categoryId || product.tags.includes(categoryId as never);
}

export const ALL_SIZES: Size[] = [
  "XS", "S", "M", "L", "XL", "XXL", "Free Size",
  "28", "30", "32", "34", "36",
  "0-6M", "6-12M", "1-2Y", "3-4Y", "5-6Y", "7-8Y", "9-10Y",
  "Single", "Double", "Queen", "King", "Standard", "16 × 16 in", "18 × 18 in", "24 × 24 in",
];

export function createCatalog({ products, categories }: CatalogSnapshot) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const bySlug = new Map(products.map((p) => [p.slug, p]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  return {
    products,
    categories,

    getProductById: (id: string) => byId.get(id),
    getProductBySlug: (slug: string) => bySlug.get(slug),
    getCategory: (id: string) => categoryById.get(id as Category["id"]),
    getCategoriesByAudience: (audience: Audience) => categories.filter((c) => c.audience === audience),

    getProductsByCategory: (categoryId: string) => products.filter((p) => productInCategory(p, categoryId)),
    getProductsByAudience: (audience: Audience) => products.filter((p) => p.audienceCategory === audience),

    /** Optionally limited to one audience — the homepage passes "women". */
    getNewArrivals(limit?: number, audience?: Audience) {
      const list = products
        .filter((p) => p.newArrival && (!audience || p.audienceCategory === audience))
        .sort((a, b) => b.addedAt - a.addedAt);
      return limit ? list.slice(0, limit) : list;
    },

    getBestSellers(limit?: number, audience?: Audience) {
      const list = products
        .filter((p) => p.bestSeller && (!audience || p.audienceCategory === audience))
        .sort((a, b) => b.sold - a.sold);
      return limit ? list.slice(0, limit) : list;
    },

    /** Never mixes audiences: a men's shirt only suggests other men's products. */
    getRelatedProducts(product: Product, limit = 4) {
      return products
        .filter((p) => p.id !== product.id && p.audienceCategory === product.audienceCategory)
        .map((p) => {
          let score = 0;
          if (p.categoryId === product.categoryId) score += 3;
          score += p.tags.filter((t) => t === product.categoryId || product.tags.includes(t)).length;
          return { p, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || b.p.rating - a.p.rating)
        .slice(0, limit)
        .map((x) => x.p);
    },

    allColors(): ProductColor[] {
      return Array.from(new Map(products.flatMap((p) => p.colors).map((c) => [c.name, c])).values());
    },
  };
}

export type Catalog = ReturnType<typeof createCatalog>;
