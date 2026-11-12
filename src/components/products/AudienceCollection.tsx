import type { Metadata } from "next";
import type { Audience } from "@/types";
import { getAudience } from "@/data/audiences";
import { getProductsByAudience } from "@/data/products";
import { AudienceHero } from "./AudienceHero";
import { ShopView } from "./ShopView";

/** Shared body of the /women, /men and /kids collection pages. */
export function AudienceCollection({ audience, sort }: { audience: Audience; sort?: string }) {
  const info = getAudience(audience);
  const list = getProductsByAudience(audience);
  return (
    <ShopView
      key={audience}
      title={info.title}
      description={info.tagline}
      breadcrumbs={[{ label: info.title }]}
      products={list}
      initialSort={sort}
      audience={audience}
      hero={<AudienceHero key="hero" info={info} productCount={list.length} />}
    />
  );
}

export function audienceMetadata(audience: Audience): Metadata {
  const info = getAudience(audience);
  return {
    title: info.title,
    description: `${info.tagline} Shop ${info.possessive.toLowerCase()} clothing at M&M COLLECTIONS, delivered across India.`,
    alternates: { canonical: info.href },
    openGraph: { images: [{ url: `${info.heroImage}&w=1200&q=75`, alt: info.title }] },
  };
}
