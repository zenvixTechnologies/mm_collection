import type { Metadata } from "next";
import { getNewArrivals } from "@/data/products";
import { ShopView } from "@/components/products/ShopView";

export const metadata: Metadata = {
  title: "New Arrivals",
  description: "The latest dresses, kurtis, co-ord sets and festive wear just in at M&M COLLECTIONS.",
  alternates: { canonical: "/new-arrivals" },
};

type Props = { searchParams: Promise<{ sort?: string; category?: string }> };

export default async function NewArrivalsPage({ searchParams }: Props) {
  const { sort, category } = await searchParams;
  return (
    <ShopView
      title="New Arrivals"
      description="Fresh styles added this season — be the first to wear them."
      breadcrumbs={[{ label: "New Arrivals" }]}
      products={getNewArrivals()}
      initialSort={sort ?? "newest"}
      initialCategory={category}
      showCategoryNav={false}
    />
  );
}
