import { MessageCircle, RotateCcw, ShieldCheck, Truck } from "lucide-react";

const items = [
  { icon: Truck, title: "Pan-India delivery", text: "Shipping charges applicable" },
  { icon: ShieldCheck, title: "Secure payments", text: "UPI, cards & net banking" },
  { icon: RotateCcw, title: "7-day returns", text: "Easy size exchanges" },
  { icon: MessageCircle, title: "WhatsApp help", text: "Sizing & styling advice" },
];

/** Slim row of the reassurances shoppers look for before buying. */
export function TrustBar() {
  return (
    <section aria-label="Why shop with us" className="border-b border-line bg-white">
      <ul className="container-page grid grid-cols-2 gap-y-4 py-5 lg:grid-cols-4 lg:py-6">
        {items.map((it, i) => (
          <li
            key={it.title}
            className={`flex items-center gap-3 lg:justify-center ${i > 0 ? "lg:border-l lg:border-line" : ""}`}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold-soft text-gold-dark ring-1 ring-gold-light">
              <it.icon size={18} />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block text-[13.5px] font-semibold text-ink sm:text-sm">{it.title}</span>
              <span className="block text-xs text-muted">{it.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
