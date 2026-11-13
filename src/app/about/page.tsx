import type { Metadata } from "next";
import Link from "next/link";
import { HeartHandshake, Leaf, Ruler, Store } from "lucide-react";
import { IMG, portrait } from "@/data/images";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { ProductImage } from "@/components/ui/ProductImage";
import { Reveal } from "@/components/ui/Reveal";

export const metadata: Metadata = {
  title: "About Us",
  description: "M&M COLLECTIONS is a family fashion destination from Alappuzha, bringing styles for women, men and kids online and in-store.",
  alternates: { canonical: "/about" },
};

const values = [
  { icon: Ruler, title: "Fit comes first", text: "Every style is checked against our size chart so what arrives fits like you expect." },
  { icon: Leaf, title: "Breathable fabrics", text: "Cottons, linens and rayons chosen for India's climate — comfortable from morning to night." },
  { icon: HeartHandshake, title: "Real support", text: "Talk to a real person on phone or WhatsApp for sizing, styling or order help." },
  { icon: Store, title: "Online & in-store", text: "Shop on our website or visit our boutique in Alappuzha to try before you buy." },
];

export default function AboutPage() {
  return (
    <div>
      <div className="container-page pt-6 lg:pt-8">
        <Breadcrumbs items={[{ label: "About Us" }]} />
        <div className="mt-6 grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <p className="eyebrow">Our story</p>
            <h1 className="mt-3 font-display text-4xl leading-tight font-semibold sm:text-5xl lg:text-6xl">
              Fashion for Every Generation, Every Occasion.
            </h1>
            <p className="mt-5 text-lg leading-8 text-muted">
              M&amp;M COLLECTIONS began its journey as a small boutique in Alappuzha, built around a simple belief: fashion should
              make everyone feel confident, comfortable and special.
            </p>
            <Link href="/shop" className="btn-primary mt-8">
              Explore the collection
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="relative aspect-4/5 overflow-hidden rounded-2xl">
              <ProductImage src={portrait(IMG.boutique)} alt="Clothing displayed in the M&M COLLECTIONS boutique" fill priority sizes="(min-width: 1024px) 25vw, 50vw" />
            </div>
            <div className="relative mt-10 aspect-4/5 overflow-hidden rounded-2xl">
              <ProductImage src={portrait(IMG.neutralRack)} alt="Rail of neutral-toned garments" fill priority sizes="(min-width: 1024px) 25vw, 50vw" />
            </div>
          </div>
        </div>
      </div>

      <section className="container-page mt-20 grid gap-8 lg:grid-cols-12 lg:gap-16" aria-labelledby="journey-heading">
        <div className="lg:col-span-4">
          <div className="lg:sticky lg:top-28">
            <p className="eyebrow">Our journey</p>
            <h2 id="journey-heading" className="mt-3 font-display text-3xl leading-tight font-semibold sm:text-4xl">
              From a boutique in Alappuzha to a fashion destination for the whole family
            </h2>
          </div>
        </div>
        <div className="space-y-5 text-[16px] leading-8 text-muted lg:col-span-8">
          <p>
            What started with a carefully curated collection of women&apos;s kurtis has gradually evolved into a fashion
            destination for the entire family. Today, we bring together a diverse range of styles for women, men and kids,
            thoughtfully selected to suit different tastes, lifestyles and occasions.
          </p>
          <p>
            From elegant dresses, churidhars, silk sarees, co-ord sets, nightwear and comfortable feeding wear for women, to
            stylish everyday essentials and contemporary outfits for men, along with adorable and comfortable clothing for kids,
            our collections celebrate individuality at every age.
          </p>
          <p>
            We believe that great fashion is not just about what you wear, but how it makes you feel. Whether you&apos;re
            dressing for a busy workday, a special celebration, a casual outing or simply looking for everyday comfort, M&amp;M
            COLLECTIONS brings together styles that make every moment feel special.
          </p>
          <p>
            From our boutique in Alappuzha to customers across India through our online store, we continue to make fashion more
            accessible, convenient and enjoyable for everyone.
          </p>
          <p>
            At M&amp;M COLLECTIONS, we are more than just a clothing store. We are a destination where every member of the family
            can discover their style, express their personality and find something they truly love.
          </p>
        </div>
      </section>

      <section className="container-page mt-16" aria-label="Our promise">
        <Reveal className="rounded-2xl border border-line px-6 py-12 text-center sm:px-12">
          <p className="eyebrow">M&amp;M COLLECTIONS</p>
          <p className="mx-auto mt-4 max-w-3xl font-display text-3xl leading-tight font-semibold sm:text-4xl">
            Your Style. Your Family. Your Fashion Destination.
          </p>
        </Reveal>
      </section>

      <section className="mt-20 bg-sand py-16" aria-labelledby="values-heading">
        <div className="container-page">
          <h2 id="values-heading" className="text-center font-display text-4xl font-semibold">
            What we stand for
          </h2>
          <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {values.map((v, i) => (
              <li key={v.title}>
                <Reveal delay={i * 0.06} className="h-full rounded-2xl bg-white p-6">
                  <v.icon className="text-accent" size={26} />
                  <h3 className="mt-4 text-lg font-semibold">{v.title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-muted">{v.text}</p>
                </Reveal>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="container-page mt-16 grid gap-6 text-center sm:grid-cols-3" aria-label="M&M COLLECTIONS in numbers">
        {[
          ["12,000+", "Happy customers"],
          ["40+", "Curated styles"],
          ["4.7★", "Average rating"],
        ].map(([n, l]) => (
          <div key={l} className="rounded-2xl border border-line py-8">
            <p className="font-display text-5xl font-semibold">{n}</p>
            <p className="mt-1 text-muted">{l}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
