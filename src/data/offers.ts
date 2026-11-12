import type { Offer } from "@/types";

export const offers: Offer[] = [
  {
    id: "o1",
    title: "Delivered across India in 3–7 days",
    subtitle: "Shipping charges applicable · Pay securely by UPI or card",
    href: "/shipping-policy",
  },
  {
    id: "o2",
    title: "New here? Get 10% off",
    subtitle: "Use code WELCOME10 at checkout",
    code: "WELCOME10",
    href: "/shop",
  },
  {
    id: "o3",
    title: "The Festive Edit is live",
    subtitle: "Silk sarees, Anarkalis and churidhar sets",
    href: "/categories/ethnic-wear",
  },
  {
    id: "o4",
    title: "Extra 20% off orders above ₹2,999",
    subtitle: "Use code FESTIVE20 — limited period",
    code: "FESTIVE20",
    href: "/shop?sort=featured",
  },
];
