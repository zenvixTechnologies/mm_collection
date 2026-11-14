import type { Metadata } from "next";
import { Clock, Mail, MapPin, Phone } from "lucide-react";
import { SITE } from "@/lib/utils";
import { ContactForm } from "@/components/layout/ContactForm";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { WhatsappIcon } from "@/components/ui/SocialIcons";

export const metadata: Metadata = {
  title: "Contact Us",
  description: "Get in touch with M&M COLLECTIONS for order help, sizing advice or store visits. Call, WhatsApp or email us.",
  alternates: { canonical: "/contact" },
};

const FAQ = [
  ["How long does delivery take?", "2–3 working days within Kerala and 4–7 days elsewhere in India."],
  ["Can I exchange for a different size?", "Yes — size exchanges are free within 7 days of delivery, subject to stock."],
  ["Do you offer Cash on Delivery?", "No — all orders are prepaid online through Razorpay by UPI, Indian credit / debit card or net banking. Shipping charges are applicable."],
  ["Do you ship outside India?", "Not at the moment. We deliver only to addresses within India and accept payments in Indian Rupees (₹) only."],
  ["Can I visit the store?", `Absolutely. We're at ${SITE.address}.`],
];

export default function ContactPage() {
  const channels = [
    { icon: <Phone size={19} />, label: "Call us", value: SITE.phone, href: `tel:${SITE.phone.replace(/\s/g, "")}` },
    { icon: <WhatsappIcon size={19} />, label: "WhatsApp", value: SITE.whatsapp, href: `https://wa.me/${SITE.whatsapp.replace(/\D/g, "")}` },
    { icon: <Mail size={19} />, label: "Email", value: SITE.email, href: `mailto:${SITE.email}` },
    { icon: <MapPin size={19} />, label: "Visit the store", value: SITE.address, href: SITE.mapLink },
    { icon: <Clock size={19} />, label: "Store hours", value: SITE.hours },
  ];

  return (
    <div className="container-page pt-6 lg:pt-8">
      <Breadcrumbs items={[{ label: "Contact Us" }]} />
      <h1 className="mt-4 font-display text-4xl font-semibold sm:text-5xl">We&apos;d love to hear from you</h1>
      <p className="mt-2 max-w-xl text-muted">Questions about sizing, an order or a product? Our team is happy to help.</p>

      <div className="mt-10 grid gap-10 lg:grid-cols-[360px_1fr] lg:gap-14">
        <ul className="space-y-3">
          {channels.map((c) => {
            const inner = (
              <>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gold-soft text-gold-dark">{c.icon}</span>
                <span className="min-w-0">
                  <span className="block text-xs text-muted">{c.label}</span>
                  <span className="block text-[15px] font-medium break-words">{c.value}</span>
                </span>
              </>
            );
            return (
              <li key={c.label}>
                {c.href ? (
                  <a
                    href={c.href}
                    {...(c.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    className="flex items-center gap-4 rounded-2xl border border-line p-4 transition-colors hover:border-ink"
                  >
                    {inner}
                  </a>
                ) : (
                  <div className="flex items-center gap-4 rounded-2xl border border-line p-4">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>

        <section aria-labelledby="form-heading" className="rounded-2xl bg-canvas p-5 sm:p-8">
          <h2 id="form-heading" className="mb-6 text-xl font-semibold">
            Send us a message
          </h2>
          <ContactForm />
        </section>
      </div>

      <section aria-labelledby="map-heading" className="mt-20">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="map-heading" className="font-display text-3xl font-semibold">
              Find our store
            </h2>
            <p className="mt-1 text-muted">{SITE.address}</p>
          </div>
          <a
            href={SITE.mapLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-ink px-5 py-2.5 text-sm font-medium transition-colors hover:bg-ink hover:text-white"
          >
            <MapPin size={16} /> Get directions
          </a>
        </div>
        <div className="mt-6 overflow-hidden rounded-2xl border border-line">
          <iframe
            src={SITE.mapEmbed}
            title={`Map showing ${SITE.name} near Thumpoly Church, Alappuzha`}
            className="block h-[320px] w-full sm:h-[420px]"
            style={{ border: 0 }}
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      </section>

      <section aria-labelledby="faq-heading" className="mt-20">
        <h2 id="faq-heading" className="font-display text-3xl font-semibold">
          Frequently asked questions
        </h2>
        <div className="mt-6 divide-y divide-line border-y border-line">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between font-medium [&::-webkit-details-marker]:hidden">
                {q}
                <span className="ml-4 text-xl text-muted transition-transform group-open:rotate-45" aria-hidden>
                  +
                </span>
              </summary>
              <p className="mt-2 text-muted">{a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
