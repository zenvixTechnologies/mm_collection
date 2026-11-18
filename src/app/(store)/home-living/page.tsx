import { AudienceCollection, audienceMetadata } from "@/components/products/AudienceCollection";

export const metadata = audienceMetadata("home-living");

type Props = { searchParams: Promise<{ sort?: string }> };

export default async function HomeLivingCollectionPage({ searchParams }: Props) {
  const { sort } = await searchParams;
  return <AudienceCollection audience="home-living" sort={sort} />;
}
