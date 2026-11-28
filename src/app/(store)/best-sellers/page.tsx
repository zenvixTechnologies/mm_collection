import type { Metadata } from "next";
import type { ListingScope } from "@/lib/listing";
import { loadListing, type SearchParams } from "@/server/services/listing-page";
import { ShopView } from "@/components/products/ShopView";

export const metadata: Metadata = {
  title: "Best Sellers",
  description: "Our customers' favourite women's, men's and kids' pieces — loved and reordered again and again.",
  alternates: { canonical: "/best-sellers" },
};

type Props = { searchParams: Promise<SearchParams> };

const SCOPE: ListingScope = { bestSeller: true, defaultSort: "best-selling" };

export default async function BestSellersPage({ searchParams }: Props) {
  const initial = await loadListing("/best-sellers", SCOPE, await searchParams);
  return (
    <ShopView
      title="Best Sellers"
      description="The pieces our customers love most — tried, tested and reordered."
      breadcrumbs={[{ label: "Best Sellers" }]}
      scope={SCOPE}
      initial={initial}
    />
  );
}
