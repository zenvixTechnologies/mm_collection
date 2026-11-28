import type { Metadata } from "next";
import type { Audience } from "@/types";
import { getAudience } from "@/data/audiences";
import type { ListingScope } from "@/lib/listing";
import { getCatalog } from "@/server/services/catalog.service";
import { loadListing, type SearchParams } from "@/server/services/listing-page";
import { CategoryGrid } from "@/components/home/CategoryGrid";
import { AudienceHero } from "./AudienceHero";
import { ShopView } from "./ShopView";

/** Shared body of the /women, /men, /kids and /home-living collection pages. */
export async function AudienceCollection({ audience, searchParams }: { audience: Audience; searchParams: SearchParams }) {
  const info = getAudience(audience);
  const list = (await getCatalog()).getProductsByAudience(audience);
  const scope: ListingScope = { audience, defaultSort: "featured" };
  const initial = await loadListing(info.href, scope, searchParams);
  return (
    <ShopView
      key={audience}
      title={info.title}
      description={info.tagline}
      breadcrumbs={[{ label: info.title }]}
      scope={scope}
      initial={initial}
      hero={
        <>
          <AudienceHero key="hero" info={info} productCount={list.length} />
          {/* Home & Living has only a few sub-categories, so they lead the page as large tiles. */}
          {info.kind === "home" && (
            <section aria-labelledby={`${audience}-categories`} className="mb-8 sm:mb-10">
              <h2 id={`${audience}-categories`} className="mb-4 font-display text-2xl font-semibold sm:text-3xl">
                Shop by category
              </h2>
              <CategoryGrid variant="page" audience={audience} includeAll={false} className="md:grid-cols-4" />
            </section>
          )}
        </>
      }
    />
  );
}

export function audienceMetadata(audience: Audience): Metadata {
  const info = getAudience(audience);
  const what = info.kind === "home" ? "bedsheets, pillow covers, cushion covers and blankets" : `${info.possessive.toLowerCase()} clothing`;
  return {
    title: info.title,
    description: `${info.tagline} Shop ${what} at M&M COLLECTIONS, delivered across India.`,
    alternates: { canonical: info.href },
    openGraph: { images: [{ url: `${info.heroImage}&w=1200&q=75`, alt: info.title }] },
  };
}
