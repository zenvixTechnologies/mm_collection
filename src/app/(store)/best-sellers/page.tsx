import type { Metadata } from "next";
import { isAudience } from "@/data/audiences";
import { getBestSellers } from "@/data/products";
import { ShopView } from "@/components/products/ShopView";

export const metadata: Metadata = {
  title: "Best Sellers",
  description: "Our customers' favourite women's, men's and kids' pieces — loved and reordered again and again.",
  alternates: { canonical: "/best-sellers" },
};

type Props = { searchParams: Promise<{ sort?: string; category?: string; for?: string }> };

export default async function BestSellersPage({ searchParams }: Props) {
  const { sort, category, for: audience } = await searchParams;
  return (
    <ShopView
      title="Best Sellers"
      description="The pieces our customers love most — tried, tested and reordered."
      breadcrumbs={[{ label: "Best Sellers" }]}
      products={getBestSellers()}
      initialSort={sort ?? "best-selling"}
      initialCategory={category}
      initialAudience={isAudience(audience) ? audience : undefined}
    />
  );
}
