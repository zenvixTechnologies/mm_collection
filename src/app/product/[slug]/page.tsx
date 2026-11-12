import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAudience } from "@/data/audiences";
import { getCategory } from "@/data/categories";
import { getProductBySlug, getRelatedProducts, products } from "@/data/products";
import { SITE } from "@/lib/utils";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ProductDetailsAccordion } from "@/components/products/ProductDetailsAccordion";
import { ProductGallery } from "@/components/products/ProductGallery";
import { ProductGrid } from "@/components/products/ProductGrid";
import { ProductPurchase } from "@/components/products/ProductPurchase";
import { ProductReviews } from "@/components/products/ProductReviews";
import { RecentlyViewed } from "@/components/products/RecentlyViewed";

type Params = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return products.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const product = getProductBySlug(slug);
  if (!product) return { title: "Product not found" };
  return {
    title: product.name,
    description: `${product.shortDescription} Shop ${product.name} at ${SITE.name} for ₹${product.price}. ${product.fabric}.`,
    alternates: { canonical: `/product/${product.slug}` },
    openGraph: {
      title: `${product.name} | ${SITE.name}`,
      description: product.shortDescription,
      images: [{ url: `${product.images[0]}&w=1200&q=75`, width: 1200, height: 1500, alt: product.name }],
    },
  };
}

export default async function ProductPage({ params }: Params) {
  const { slug } = await params;
  const product = getProductBySlug(slug);
  if (!product) notFound();
  const category = getCategory(product.categoryId);
  const audience = getAudience(product.audienceCategory);
  // Same audience only — getRelatedProducts never suggests a men's shirt on a kids' frock.
  const related = getRelatedProducts(product, 4);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    sku: product.sku,
    audience: {
      "@type": "PeopleAudience",
      suggestedGender: product.audienceCategory === "women" ? "female" : product.audienceCategory === "men" ? "male" : "unisex",
      ...(product.audienceCategory === "kids" ? { suggestedMaxAge: 10 } : { suggestedMinAge: 16 }),
    },
    image: product.images.map((i) => `${i}&w=1200`),
    description: product.description,
    brand: { "@type": "Brand", name: SITE.name, logo: `${SITE.url}/brand/logo-512.png` },
    aggregateRating: { "@type": "AggregateRating", ratingValue: product.rating, reviewCount: product.reviewCount },
    offers: {
      "@type": "Offer",
      priceCurrency: "INR",
      price: product.price,
      availability: product.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url: `${SITE.url}/product/${product.slug}`,
    },
  };

  return (
    <div className="pb-24 sm:pb-0">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="container-page pt-5 lg:pt-8">
        <Breadcrumbs
          items={[
            { label: audience.title, href: audience.href },
            ...(category ? [{ label: category.name, href: `/categories/${category.slug}` }] : []),
            { label: product.name },
          ]}
        />
        <div className="mt-5 grid gap-8 lg:mt-7 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <ProductGallery images={product.images} name={product.name} />
          </div>
          <div>
            <ProductPurchase product={product} />
            <div className="mt-10">
              <ProductDetailsAccordion product={product} />
            </div>
          </div>
        </div>

        <div className="mt-20">
          <ProductReviews product={product} />
        </div>

        {related.length > 0 && (
          <section aria-labelledby="related-heading" className="mt-20">
            <SectionHeading
              id="related-heading"
              eyebrow="Complete the look"
              title="You may also like"
              href={category ? `/categories/${category.slug}` : audience.href}
            />
            <ProductGrid products={related} />
          </section>
        )}
      </div>
      <RecentlyViewed excludeId={product.id} />
    </div>
  );
}
