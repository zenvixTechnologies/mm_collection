import type { Metadata } from "next";
import Link from "next/link";
import { AUDIENCES } from "@/data/audiences";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { CategoryGrid } from "@/components/home/CategoryGrid";

export const metadata: Metadata = {
  title: "Shop by Category",
  description:
    "Explore M&M COLLECTIONS by category: women's dresses, kurtis, sarees and feeding wear; men's shirts, jeans and kurtas; kids' frocks, sets and baby clothing.",
  alternates: { canonical: "/categories" },
};

export default function CategoriesPage() {
  return (
    <div className="container-page pt-6 lg:pt-8">
      <Breadcrumbs items={[{ label: "Categories" }]} />
      <header className="mt-4 mb-8">
        <h1 className="font-display text-4xl font-semibold sm:text-5xl">Shop by Category</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Find exactly what you&apos;re looking for — from everyday kurtis to festive silks, sharp shirts and little ones&apos; frocks.
        </p>
        <nav aria-label="Jump to" className="mt-5 flex flex-wrap gap-2">
          {AUDIENCES.map((a) => (
            <a
              key={a.id}
              href={`#${a.id}`}
              className="rounded-full border border-line px-4 py-2 text-sm font-medium transition-colors hover:border-ink"
            >
              {a.label}
            </a>
          ))}
        </nav>
      </header>

      <div className="space-y-16">
        {AUDIENCES.map((a) => (
          <section key={a.id} id={a.id} aria-labelledby={`${a.id}-heading`} className="scroll-mt-28">
            <div className="mb-5 flex items-end justify-between gap-4">
              <h2 id={`${a.id}-heading`} className="font-display text-3xl font-semibold">
                {a.title}
              </h2>
              <Link href={a.href} className="text-sm font-semibold text-accent hover:underline">
                Shop all {a.label} →
              </Link>
            </div>
            <CategoryGrid variant="page" audience={a.id} />
          </section>
        ))}
      </div>
    </div>
  );
}
