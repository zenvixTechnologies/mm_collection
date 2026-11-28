import type { Metadata } from "next";
import type { ListingScope } from "@/lib/listing";
import { loadListing, type SearchParams } from "@/server/services/listing-page";
import { ShopView } from "@/components/products/ShopView";

export const metadata: Metadata = {
  title: "New Arrivals",
  description: "The latest women's, men's and kids' styles just in at M&M COLLECTIONS.",
  alternates: { canonical: "/new-arrivals" },
};

type Props = { searchParams: Promise<SearchParams> };

const SCOPE: ListingScope = { newArrival: true, defaultSort: "newest" };

export default async function NewArrivalsPage({ searchParams }: Props) {
  const initial = await loadListing("/new-arrivals", SCOPE, await searchParams);
  return (
    <ShopView
      title="New Arrivals"
      description="Fresh styles added this season — be the first to wear them."
      breadcrumbs={[{ label: "New Arrivals" }]}
      scope={SCOPE}
      initial={initial}
    />
  );
}
