import { AudienceCollection, audienceMetadata } from "@/components/products/AudienceCollection";

export const metadata = audienceMetadata("kids");

type Props = { searchParams: Promise<{ sort?: string }> };

export default async function KidsCollectionPage({ searchParams }: Props) {
  const { sort } = await searchParams;
  return <AudienceCollection audience="kids" sort={sort} />;
}
