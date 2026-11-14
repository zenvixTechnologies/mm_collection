import { AudienceCollection, audienceMetadata } from "@/components/products/AudienceCollection";

export const metadata = audienceMetadata("women");

type Props = { searchParams: Promise<{ sort?: string }> };

export default async function WomenCollectionPage({ searchParams }: Props) {
  const { sort } = await searchParams;
  return <AudienceCollection audience="women" sort={sort} />;
}
