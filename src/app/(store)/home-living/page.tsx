import { AudienceCollection, audienceMetadata } from "@/components/products/AudienceCollection";
import type { SearchParams } from "@/server/services/listing-page";

export const metadata = audienceMetadata("home-living");

type Props = { searchParams: Promise<SearchParams> };

export default async function HomeLivingCollectionPage({ searchParams }: Props) {
  return <AudienceCollection audience="home-living" searchParams={await searchParams} />;
}
