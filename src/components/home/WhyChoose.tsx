import { Gem, Headphones, ShoppingBag, Truck } from "lucide-react";
import { Reveal } from "@/components/ui/Reveal";

const reasons = [
  {
    icon: Gem,
    title: "Quality collections",
    text: "Every piece is hand-checked for fabric, stitching and fit before it reaches you.",
  },
  {
    icon: ShoppingBag,
    title: "Easy online shopping",
    text: "Clear sizes, real photos and simple filters to find your style in minutes.",
  },
  {
    icon: Truck,
    title: "Convenient ordering",
    text: "Cash on Delivery, UPI or card, with free delivery on orders above ₹999.",
  },
  {
    icon: Headphones,
    title: "Friendly support",
    text: "Need help with sizing? Call or WhatsApp us — we reply within a few hours.",
  },
];

export function WhyChoose() {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {reasons.map((r, i) => (
        <li key={r.title}>
          <Reveal delay={i * 0.06} className="h-full rounded-2xl border border-line bg-white p-6 transition-shadow hover:border-gold-light hover:shadow-[var(--shadow-card)]">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gold-soft text-gold-dark ring-1 ring-gold-light">
              <r.icon size={22} />
            </span>
            <h3 className="mt-5 text-[17px] font-semibold">{r.title}</h3>
            <p className="mt-1.5 text-sm leading-6 text-muted">{r.text}</p>
          </Reveal>
        </li>
      ))}
    </ul>
  );
}
