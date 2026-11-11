import { getBestSellers, getNewArrivals } from "@/data/products";
import { CategoryGrid } from "@/components/home/CategoryGrid";
import { FeaturedCollections } from "@/components/home/FeaturedCollections";
import { Hero } from "@/components/home/Hero";
import { Newsletter } from "@/components/home/Newsletter";
import { PromoBanner } from "@/components/home/PromoBanner";
import { Testimonials } from "@/components/home/Testimonials";
import { TrustBar } from "@/components/home/TrustBar";
import { WhyChoose } from "@/components/home/WhyChoose";
import { ProductGrid } from "@/components/products/ProductGrid";
import { SectionHeading } from "@/components/ui/SectionHeading";
import Link from "next/link";

export default function HomePage() {
  const newArrivals = getNewArrivals(8);
  const bestSellers = getBestSellers(8);

  return (
    <>
      <Hero />
      <TrustBar />

      <section aria-labelledby="cat-heading" className="container-page mt-14 sm:mt-20">
        <SectionHeading id="cat-heading" eyebrow="Explore" title="Shop by Category" href="/categories" linkLabel="All categories" />
        <CategoryGrid />
      </section>

      <section aria-labelledby="new-heading" className="container-page mt-16 sm:mt-24">
        <SectionHeading
          id="new-heading"
          eyebrow="Just landed"
          title="New Arrivals"
          description="Fresh styles for the season, added this month."
          href="/new-arrivals"
        />
        <ProductGrid products={newArrivals} />
        <MobileViewAll href="/new-arrivals" label="View all new arrivals" />
      </section>

      <section aria-labelledby="collections-heading" className="container-page mt-16 sm:mt-24">
        <SectionHeading id="collections-heading" eyebrow="Curated for you" title="Featured Collections" />
        <FeaturedCollections />
      </section>

      {/* Tinted band breaks up the white and gives the bestsellers their own stage. */}
      <section aria-labelledby="best-heading" className="mt-16 bg-sand py-14 sm:mt-24 sm:py-20">
        <div className="container-page">
          <SectionHeading
            id="best-heading"
            eyebrow="Customer favourites"
            title="Best Sellers"
            description="Loved, reviewed and reordered by thousands of women."
            href="/best-sellers"
          />
          <ProductGrid products={bestSellers} showRating />
          <MobileViewAll href="/best-sellers" label="View all best sellers" />
        </div>
      </section>

      <section aria-label="Seasonal offer" className="container-page mt-16 sm:mt-24">
        <PromoBanner />
      </section>

      <section aria-labelledby="why-heading" className="container-page mt-16 sm:mt-24">
        <SectionHeading id="why-heading" eyebrow="Our promise" title="Why choose M&M COLLECTIONS?" />
        <WhyChoose />
      </section>

      <section aria-labelledby="reviews-home-heading" className="container-page mt-16 sm:mt-24">
        <SectionHeading id="reviews-home-heading" eyebrow="Real reviews" title="What our customers say" />
        <Testimonials />
      </section>

      <section aria-label="Newsletter" className="container-page mt-16 sm:mt-24">
        <Newsletter />
      </section>
    </>
  );
}

function MobileViewAll({ href, label }: { href: string; label: string }) {
  return (
    <div className="mt-8 text-center sm:hidden">
      <Link href={href} className="btn-outline w-full">
        {label}
      </Link>
    </div>
  );
}
