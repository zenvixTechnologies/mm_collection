import { AudienceCollection, audienceMetadata } from "@/components/products/AudienceCollection";
import type { SearchParams } from "@/server/services/listing-page";

export const metadata = audienceMetadata("women");

type Props = { searchParams: Promise<SearchParams> };

export default async function WomenCollectionPage({ searchParams }: Props) {
  return <AudienceCollection audience="women" searchParams={await searchParams} />;
}
