import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { categories, getCategory } from "@/data/categories";
import { getProductsByCategory } from "@/data/products";
import { ShopView } from "@/components/products/ShopView";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ sort?: string }>;
};

export function generateStaticParams() {
  return categories.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const category = getCategory(slug);
  if (!category) return { title: "Category not found" };
  return {
    title: `${category.name} for Women`,
    description: `${category.description} Shop ${category.name.toLowerCase()} at M&M COLLECTIONS with free delivery over ₹999.`,
    alternates: { canonical: `/categories/${category.slug}` },
    openGraph: { images: [{ url: `${category.image}&w=1200&q=75`, alt: category.name }] },
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { sort } = await searchParams;
  const category = getCategory(slug);
  if (!category) notFound();

  return (
    <ShopView
      key={category.id}
      title={category.name}
      description={category.description}
      breadcrumbs={[{ label: "Categories", href: "/categories" }, { label: category.name }]}
      products={getProductsByCategory(category.id)}
      initialSort={sort}
      lockedCategory={category.id}
    />
  );
}
