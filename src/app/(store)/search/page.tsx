import type { Metadata } from "next";
import { isAudience } from "@/data/audiences";
import { SearchResults } from "@/components/products/SearchResults";

type Props = { searchParams: Promise<{ q?: string; for?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  return {
    title: q ? `Search results for "${q}"` : "Search",
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({ searchParams }: Props) {
  const { q = "", for: scope } = await searchParams;
  return <SearchResults key={q} initialQuery={q} scope={isAudience(scope) ? scope : null} />;
}
