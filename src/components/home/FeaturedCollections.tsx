import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { IMG, portrait } from "@/data/images";
import { ProductImage } from "@/components/ui/ProductImage";
import { Reveal } from "@/components/ui/Reveal";

const collections = [
  {
    title: "The Festive Edit",
    text: "Silk sarees, Anarkalis and churidhar sets for the season of celebrations.",
    href: "/categories/ethnic-wear",
    image: portrait(IMG.purpleSaree),
    alt: "Woman in a purple silk saree with gold border",
  },
  {
    title: "Summer Dresses",
    text: "Light cottons and flowing maxis made for warm days.",
    href: "/categories/dresses",
    image: portrait(IMG.blueMaxiDress),
    alt: "Woman in a powder blue maxi dress on the beach",
  },
  {
    title: "Modern Workwear",
    text: "Blazers, co-ords and sharp tailoring for the week ahead.",
    href: "/categories/western-wear",
    image: portrait(IMG.whiteBlazer),
    alt: "Woman in an ivory tailored blazer",
  },
];

export function FeaturedCollections() {
  return (
    <div className="grid gap-4 md:grid-cols-3 md:gap-5">
      {collections.map((c, i) => (
        <Reveal key={c.title} delay={i * 0.08}>
          <Link href={c.href} className="group relative block overflow-hidden rounded-2xl">
            <div className="relative aspect-[4/5] md:aspect-[3/4]">
              <ProductImage
                src={c.image}
                alt={c.alt}
                fill
                sizes="(min-width: 768px) 33vw, 100vw"
                className="transition-transform duration-700 ease-out group-hover:scale-[1.05]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
            </div>
            <div className="absolute inset-x-0 bottom-0 p-6 text-white">
              <h3 className="font-display text-3xl font-semibold text-white">{c.title}</h3>
              <p className="mt-1 max-w-xs text-sm text-white/85">{c.text}</p>
              <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold underline-offset-4 group-hover:underline">
                Explore <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
              </span>
            </div>
          </Link>
        </Reveal>
      ))}
    </div>
  );
}
