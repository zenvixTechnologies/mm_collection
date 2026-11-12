import type { Metadata } from "next";
import { isAudience } from "@/data/audiences";
import { products } from "@/data/products";
import { ShopView } from "@/components/products/ShopView";

export const metadata: Metadata = {
  title: "Shop All — Women, Men & Kids",
  description:
    "Browse every M&M COLLECTIONS piece — women's kurtis, dresses and sarees, men's shirts, jeans and kurtas, and kids' frocks and sets. Filter by size, colour and price.",
  alternates: { canonical: "/shop" },
};

type Props = { searchParams: Promise<{ sort?: string; category?: string; for?: string }> };

export default async function ShopPage({ searchParams }: Props) {
  const { sort, category, for: audience } = await searchParams;
  return (
    <ShopView
      title="Shop All"
      description="Every piece for women, men and kids, in one place. Use the filters to find your size, colour and budget."
      breadcrumbs={[{ label: "Shop" }]}
      products={products}
      initialSort={sort}
      initialCategory={category}
      initialAudience={isAudience(audience) ? audience : undefined}
    />
  );
}
