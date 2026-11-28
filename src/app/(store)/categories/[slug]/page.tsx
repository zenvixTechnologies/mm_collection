import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAudience } from "@/data/audiences";
import { categoryFullName } from "@/lib/catalog-query";
import type { ListingScope } from "@/lib/listing";
import { getCatalog } from "@/server/services/catalog.service";
import { loadListing, type SearchParams } from "@/server/services/listing-page";
import { AudienceHero } from "@/components/products/AudienceHero";
import { ShopView } from "@/components/products/ShopView";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
};

export async function generateStaticParams() {
  const { categories } = await getCatalog();
  return categories.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const category = (await getCatalog()).getCategory(slug);
  if (!category) return { title: "Category not found" };
  return {
    title:
      getAudience(category.audience).kind === "home"
        ? `${category.name} · ${getAudience(category.audience).title}`
        : `${categoryFullName(category)} for ${getAudience(category.audience).label}`,
    description: `${category.description} Shop ${categoryFullName(category).toLowerCase()} at M&M COLLECTIONS, delivered across India.`,
    alternates: { canonical: `/categories/${category.slug}` },
    openGraph: { images: [{ url: `${category.image}&w=1200&q=75`, alt: category.name }] },
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { getCategory, getProductsByCategory } = await getCatalog();
  const category = getCategory(slug);
  if (!category) notFound();
  const info = getAudience(category.audience);
  const list = getProductsByCategory(category.id);
  const scope: ListingScope = { audience: category.audience, category: category.id, defaultSort: "featured" };
  const initial = await loadListing(`/categories/${category.slug}`, scope, await searchParams);

  return (
    <ShopView
      key={category.id}
      title={categoryFullName(category)}
      description={category.description}
      breadcrumbs={[{ label: info.title, href: info.href }, { label: category.name }]}
      scope={scope}
      initial={initial}
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
