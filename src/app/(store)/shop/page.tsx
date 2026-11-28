import type { Metadata } from "next";
import type { ListingScope } from "@/lib/listing";
import { loadListing, type SearchParams } from "@/server/services/listing-page";
import { ShopView } from "@/components/products/ShopView";

export const metadata: Metadata = {
  title: "Shop All — Women, Men & Kids",
  description:
    "Browse every M&M COLLECTIONS piece — women's kurtis, dresses and sarees, men's shirts, jeans and kurtas, and kids' frocks and sets. Filter by size, colour and price.",
  alternates: { canonical: "/shop" },
};

type Props = { searchParams: Promise<SearchParams> };

const SCOPE: ListingScope = { defaultSort: "featured" };

export default async function ShopPage({ searchParams }: Props) {
  const initial = await loadListing("/shop", SCOPE, await searchParams);
  return (
    <ShopView
      title="Shop All"
      description="Every piece for women, men and kids, in one place. Use the filters to find your size, colour and budget."
      breadcrumbs={[{ label: "Shop" }]}
      scope={SCOPE}
      initial={initial}
    />
  );
}
