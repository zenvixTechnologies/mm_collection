import type { Metadata } from "next";
import { products } from "@/data/products";
import { ShopView } from "@/components/products/ShopView";

export const metadata: Metadata = {
  title: "Shop All Women's Clothing",
  description:
    "Browse every M&M COLLECTIONS piece — dresses, kurtis, churidhars, sarees, co-ord sets, party wear, nightwear and feeding wear. Filter by size, colour and price.",
  alternates: { canonical: "/shop" },
};

type Props = { searchParams: Promise<{ sort?: string; category?: string }> };

export default async function ShopPage({ searchParams }: Props) {
  const { sort, category } = await searchParams;
  return (
    <ShopView
      title="Shop All"
      description="Every piece in our collection, in one place. Use the filters to find your size, colour and budget."
      breadcrumbs={[{ label: "Shop" }]}
      products={products}
      initialSort={sort}
      initialCategory={category}
    />
  );
}
