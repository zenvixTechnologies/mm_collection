import Link from "next/link";
import { getBestSellers } from "@/data/products";
import { ProductGrid } from "@/components/products/ProductGrid";
import { SectionHeading } from "@/components/ui/SectionHeading";

export default function NotFound() {
  return (
    <div className="container-page pt-14 sm:pt-20">
      <div className="mx-auto max-w-lg text-center">
        <p className="font-display text-[88px] leading-none font-semibold text-accent/25 sm:text-[120px]" aria-hidden>404</p>
        <h1 className="mt-2 font-display text-4xl font-semibold">This page has gone out of style</h1>
        <p className="mt-3 text-muted">The page you&apos;re looking for doesn&apos;t exist or may have moved.</p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href="/" className="btn-primary px-8">
            Go to Homepage
          </Link>
          <Link href="/shop" className="btn-outline px-8">
            Shop All
          </Link>
        </div>
      </div>
      <section className="mt-20" aria-labelledby="nf-heading">
        <SectionHeading id="nf-heading" title="Popular right now" href="/best-sellers" />
        <ProductGrid products={getBestSellers(4)} />
      </section>
    </div>
  );
}
