import Link from "next/link";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";

const POLICIES = [
  { href: "/shipping-policy", label: "Shipping Policy" },
  { href: "/return-policy", label: "Return & Refund Policy" },
  { href: "/privacy-policy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms & Conditions" },
];

export function PolicyPage({ title, updated, current, children }: { title: string; updated: string; current: string; children: React.ReactNode }) {
  return (
    <div className="container-page pt-6 lg:pt-8">
      <Breadcrumbs items={[{ label: title }]} />
      <div className="mt-6 grid gap-10 lg:grid-cols-[220px_1fr] lg:gap-16">
        <nav aria-label="Policies" className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:gap-1 lg:px-0">
            {POLICIES.map((p) => (
              <li key={p.href} className="shrink-0">
                <Link
                  href={p.href}
                  aria-current={p.href === current ? "page" : undefined}
                  className={
                    p.href === current
                      ? "block rounded-full bg-ink px-4 py-2 text-sm font-medium text-white lg:rounded-xl"
                      : "block rounded-full bg-canvas px-4 py-2 text-sm text-ink hover:bg-sand lg:rounded-xl lg:bg-transparent"
                  }
                >
                  {p.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <article className="prose-policy min-w-0 max-w-3xl">
          <h1 className="font-display text-4xl font-semibold sm:text-5xl">{title}</h1>
          <p className="!mt-3 text-sm">Last updated: {updated}</p>
          {children}
        </article>
      </div>
    </div>
  );
}
