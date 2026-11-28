import { AudienceCollection, audienceMetadata } from "@/components/products/AudienceCollection";
import type { SearchParams } from "@/server/services/listing-page";

export const metadata = audienceMetadata("kids");

type Props = { searchParams: Promise<SearchParams> };

export default async function KidsCollectionPage({ searchParams }: Props) {
  return <AudienceCollection audience="kids" searchParams={await searchParams} />;
}
