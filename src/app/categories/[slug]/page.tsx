import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAudience } from "@/data/audiences";
import { categories, categoryFullName, getCategory } from "@/data/categories";
import { getProductsByCategory } from "@/data/products";
import { AudienceHero } from "@/components/products/AudienceHero";
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
    title: `${categoryFullName(category)} for ${getAudience(category.audience).label}`,
    description: `${category.description} Shop ${categoryFullName(category).toLowerCase()} at M&M COLLECTIONS with free delivery over ₹999.`,
    alternates: { canonical: `/categories/${category.slug}` },
    openGraph: { images: [{ url: `${category.image}&w=1200&q=75`, alt: category.name }] },
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { sort } = await searchParams;
  const category = getCategory(slug);
  if (!category) notFound();
  const info = getAudience(category.audience);
  const list = getProductsByCategory(category.id);

  return (
    <ShopView
      key={category.id}
      title={categoryFullName(category)}
      description={category.description}
      breadcrumbs={[{ label: info.title, href: info.href }, { label: category.name }]}
      products={list}
      initialSort={sort}
      lockedCategory={category.id}
      audience={category.audience}
      hero={
        <AudienceHero
          key="hero"
          info={info}
          productCount={list.length}
          eyebrow={info.title}
          title={categoryFullName(category)}
          description={category.description}
          image={category.image}
        />
      }
    />
  );
}
