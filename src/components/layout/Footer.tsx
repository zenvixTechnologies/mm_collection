import Link from "next/link";
import { Mail, MapPin, Phone } from "lucide-react";
import { AUDIENCES } from "@/data/audiences";
import { getCategoriesByAudience } from "@/data/categories";
import { SITE } from "@/lib/utils";
import { FacebookIcon, InstagramIcon, WhatsappIcon, YoutubeIcon } from "@/components/ui/SocialIcons";
import { Logo } from "./Logo";

const quickLinks = [
  { href: "/shop", label: "Shop All" },
  { href: "/new-arrivals", label: "New Arrivals" },
  { href: "/best-sellers", label: "Best Sellers" },
  { href: "/about", label: "About Us" },
  { href: "/contact", label: "Contact Us" },
  { href: "/track-order", label: "Track Order" },
];

const policies = [
  { href: "/shipping-policy", label: "Shipping Policy" },
  { href: "/return-policy", label: "Return & Refund Policy" },
  { href: "/privacy-policy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms & Conditions" },
];

const socials = [
  { href: "https://instagram.com", label: "Instagram", icon: <InstagramIcon /> },
  { href: "https://facebook.com", label: "Facebook", icon: <FacebookIcon /> },
  { href: "https://youtube.com", label: "YouTube", icon: <YoutubeIcon /> },
  { href: `https://wa.me/${SITE.whatsapp.replace(/\D/g, "")}`, label: "WhatsApp", icon: <WhatsappIcon /> },
];

export function Footer() {
  return (
    <footer className="relative mt-20 bg-royal text-white/70">
      <div className="gold-rule absolute inset-x-0 top-0" aria-hidden />
      <div className="container-page grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1.3fr]">
        <div>
          <Logo size="footer" onDark />
          <p className="mt-4 max-w-xs text-sm leading-6 text-white/65">
            {SITE.name} brings you thoughtfully chosen ladies&apos; fashion — everyday kurtis, dresses, festive wear and
            feeding wear — plus clothing for men and kids, online and at our store in Alappuzha.
          </p>
          <ul className="mt-5 flex gap-2" aria-label="Social media">
            {socials.map((s) => (
              <li key={s.label}>
                <a
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${SITE.name} on ${s.label}`}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-gold/40 text-gold-light transition-colors hover:border-gold hover:bg-gold hover:text-royal"
                >
                  {s.icon}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <FooterColumn title="Quick Links" links={quickLinks} />
        <FooterColumn
          title="Shop"
          links={[
            ...AUDIENCES.map((a) => ({ href: a.href, label: `Shop ${a.label}` })),
            ...getCategoriesByAudience("women")
              .slice(0, 4)
              .map((c) => ({ href: `/categories/${c.slug}`, label: c.name })),
          ]}
        />
        <FooterColumn title="Policies" links={policies} />

        <div>
          <h2 className="mb-4 text-sm font-semibold tracking-[0.16em] text-gold-light uppercase">Contact</h2>
          <ul className="space-y-3 text-sm text-white/65">
            <li className="flex gap-2.5">
              <MapPin size={16} className="mt-0.5 shrink-0 text-gold" />
              <span>{SITE.address}</span>
            </li>
            <li>
              <a href={`tel:${SITE.phone.replace(/\s/g, "")}`} className="flex gap-2.5 hover:text-white">
                <Phone size={16} className="mt-0.5 shrink-0 text-gold" />
                {SITE.phone}
              </a>
            </li>
            <li>
              <a href={`mailto:${SITE.email}`} className="flex gap-2.5 hover:text-white">
                <Mail size={16} className="mt-0.5 shrink-0 text-gold" />
                {SITE.email}
              </a>
            </li>
            <li className="pl-6.5 text-xs">{SITE.hours}</li>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="container-page flex flex-col items-center justify-between gap-3 py-5 text-xs text-white/55 sm:flex-row">
          <p>© {new Date().getFullYear()} {SITE.name}. All rights reserved.</p>
          <p className="flex items-center gap-2">
            We accept
            <span className="rounded border border-white/15 px-1.5 py-0.5 font-semibold text-white/85">UPI</span>
            <span className="rounded border border-white/15 px-1.5 py-0.5 font-semibold text-white/85">Cards</span>
            <span className="rounded border border-white/15 px-1.5 py-0.5 font-semibold text-white/85">Net Banking</span>
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <h2 className="mb-4 text-sm font-semibold tracking-[0.16em] text-gold-light uppercase">{title}</h2>
      <ul className="space-y-2.5 text-sm">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="text-white/65 transition-colors hover:text-white">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
