import "server-only";
import type { Types } from "mongoose";
import type { Audience } from "@/types";
import { AUDIENCES } from "@/data/audiences";
import { categoryFullName } from "@/lib/catalog-query";
import { searchStem, searchTerms } from "@/lib/catalog";
import type { ListingFacets } from "@/lib/listing";
import { Product } from "@/server/models/product.model";

/** MongoDB building blocks for the product listing. */

/** Aggregation conditions: variant `$$v` is on sale with units a shopper can buy. Reserved units don't count. */
const ON_SALE_WITH_STOCK = [
  { $ne: ["$$v.isActive", false] },
  { $gt: [{ $subtract: ["$$v.stock", { $ifNull: ["$$v.reserved", 0] }] }, 0] },
];

/**
 * `$expr` matching products where ONE variant is on sale, has stock available and satisfies every
 * choice. Shopper input goes through `$literal`: inside an expression a string such as
 * "$variants.size" would otherwise be read as a field path.
 */
export function availableVariant({ sizes, colors }: { sizes?: string[]; colors?: string[] }) {
  return {
    $anyElementTrue: [
      {
        $map: {
          input: { $ifNull: ["$variants", []] },
          as: "v",
          in: {
            $and: [
              ...ON_SALE_WITH_STOCK,
              ...(sizes?.length ? [{ $in: ["$$v.size", { $literal: sizes }] }] : []),
              ...(colors?.length ? [{ $in: ["$$v.color.name", { $literal: colors }] }] : []),
            ],
          },
        },
      },
    ],
  };
}

const wordsOf = (text: string) => text.toLowerCase().normalize("NFKD").split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Search within a listing, with the same matching as the storefront's search box: every word must
 * start a word in the name, short description, fabric, SKU, an on-sale colour, a category name or
 * the main category's keywords. Terms are only a–z and 0–9, so they are safe inside a RegExp.
 */
export function searchConditions(query: string, categories: { _id: Types.ObjectId; audience: string; name: string }[]) {
  return searchTerms(query)
    .slice(0, 8)
    .map((term) => {
      const stem = searchStem(term);
      const starts = stem.length > 2 && stem !== term ? [term, stem] : [term];
      const pattern = new RegExp(`(^|[^a-z0-9])(${starts.join("|")})`, "i");
      const matches = (text: string) => wordsOf(text).some((w) => starts.some((s) => w.startsWith(s)));
      const categoryIds = categories
        .filter((c) => matches(categoryFullName({ audience: c.audience as Audience, name: c.name })))
        .map((c) => c._id);
      const audiences = AUDIENCES.filter((a) => matches(a.keywords.join(" "))).map((a) => a.id);
      return {
        $or: [
          { name: pattern },
          { shortDescription: pattern },
          { fabric: pattern },
          { sku: pattern },
          { variants: { $elemMatch: { isActive: { $ne: false }, "color.name": pattern } } },
          ...(categoryIds.length ? [{ category: { $in: categoryIds } }, { tags: { $in: categoryIds } }] : []),
          ...(audiences.length ? [{ audience: { $in: audiences } }] : []),
        ],
      };
    });
}

interface FacetRows {
  audiences: { _id: Audience; count: number }[];
  categories: { _id: Types.ObjectId; count: number }[];
  variants: { _id: { size?: string | null; color?: string | null }; hex?: string | null; first?: Date | null }[];
  price: { min: number; max: number }[];
}

/**
 * Filter options, computed in the database. Audiences come from the whole listing, sub-categories
 * from the chosen audience, and sizes, colours and the price range from the chosen audience and
 * sub-categories. The other filters don't narrow them, so options don't vanish while combining.
 */
export async function listingFacets(
  base: Record<string, unknown>,
  byAudience: Record<string, unknown>,
  byCategory: Record<string, unknown>,
  slugOf: (id: Types.ObjectId) => string | undefined,
): Promise<ListingFacets> {
  const chosen = { $match: { ...byAudience, ...byCategory } };
  const [rows] = await Product.aggregate<FacetRows>([
    { $match: base },
    {
      $facet: {
        audiences: [{ $group: { _id: "$audience", count: { $sum: 1 } } }],
        categories: [
          { $match: byAudience },
          { $project: { in: { $setUnion: [["$category"], { $ifNull: ["$tags", []] }] } } },
          { $unwind: "$in" },
          { $group: { _id: "$in", count: { $sum: 1 } } },
        ],
        variants: [
          chosen,
          // Oldest products first, so colour options keep a stable order and shade.
          { $sort: { publishedAt: 1, _id: 1 } },
          {
            $project: {
              publishedAt: 1,
              v: { $filter: { input: { $ifNull: ["$variants", []] }, as: "v", cond: { $and: ON_SALE_WITH_STOCK } } },
            },
          },
          { $unwind: "$v" },
          { $group: { _id: { size: "$v.size", color: "$v.color.name" }, hex: { $first: "$v.color.hex" }, first: { $min: "$publishedAt" } } },
        ],
        price: [chosen, { $group: { _id: null, min: { $min: "$pricePaise" }, max: { $max: "$pricePaise" } } }],
      },
    },
  ]);

  const sizes = new Set<string>();
  const colors = new Map<string, string>();
  const ordered = [...rows.variants].sort(
    (a, b) => (a.first?.getTime() ?? 0) - (b.first?.getTime() ?? 0) || (a._id.color ?? "").localeCompare(b._id.color ?? ""),
  );
  for (const { _id, hex } of ordered) {
    if (_id.size) sizes.add(_id.size);
    if (_id.color && !colors.has(_id.color)) colors.set(_id.color, hex ?? "#CCCCCC");
  }
  const price = rows.price[0];

  return {
    audiences: AUDIENCES.flatMap((a) => {
      const row = rows.audiences.find((r) => r._id === a.id);
      return row ? [{ id: a.id, count: row.count }] : [];
    }),
    categories: rows.categories.flatMap((r) => {
      const id = slugOf(r._id);
      return id ? [{ id, count: r.count }] : [];
    }),
    sizes: [...sizes],
    colors: [...colors].map(([name, hex]) => ({ name, hex })),
    price: price ? { min: price.min / 100, max: price.max / 100 } : null,
  };
}
