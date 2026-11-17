import { AudienceCollection, audienceMetadata } from "@/components/products/AudienceCollection";

export const metadata = audienceMetadata("men");

type Props = { searchParams: Promise<{ sort?: string }> };

export default async function MenCollectionPage({ searchParams }: Props) {
  const { sort } = await searchParams;
  return <AudienceCollection audience="men" sort={sort} />;
}
