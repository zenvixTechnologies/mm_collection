import type { Metadata } from "next";
import { SearchResults } from "@/components/products/SearchResults";

type Props = { searchParams: Promise<{ q?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  return {
    title: q ? `Search results for "${q}"` : "Search",
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({ searchParams }: Props) {
  const { q = "" } = await searchParams;
  return <SearchResults key={q} initialQuery={q} />;
}
