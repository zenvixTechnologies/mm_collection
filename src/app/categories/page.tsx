import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { CategoryGrid } from "@/components/home/CategoryGrid";

export const metadata: Metadata = {
  title: "Shop by Category",
  description: "Explore M&M COLLECTIONS by category: dresses, tops, kurtis, churidhars, sarees, co-ord sets, ethnic, western, party, nightwear and feeding wear.",
  alternates: { canonical: "/categories" },
};

export default function CategoriesPage() {
  return (
    <div className="container-page pt-6 lg:pt-8">
      <Breadcrumbs items={[{ label: "Categories" }]} />
      <header className="mt-4 mb-8">
        <h1 className="font-display text-4xl font-semibold sm:text-5xl">Shop by Category</h1>
        <p className="mt-2 max-w-2xl text-muted">Find exactly what you&apos;re looking for — from everyday kurtis to festive silks.</p>
      </header>
      <CategoryGrid variant="page" />
    </div>
  );
}
