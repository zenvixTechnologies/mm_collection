import { AudienceCollection, audienceMetadata } from "@/components/products/AudienceCollection";
import type { SearchParams } from "@/server/services/listing-page";

export const metadata = audienceMetadata("men");

type Props = { searchParams: Promise<SearchParams> };

export default async function MenCollectionPage({ searchParams }: Props) {
  return <AudienceCollection audience="men" searchParams={await searchParams} />;
}
