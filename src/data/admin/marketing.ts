import type { AdminCoupon, AdminOffer, HomepageBanner, HomepageSection } from "@/types/admin";
import { coupons } from "@/data/coupons";
import { IMG, portrait, wide } from "@/data/images";
import { offers } from "@/data/offers";
import { getBestSellers } from "@/data/products";
import { daysAgo } from "./mock-utils";

/* ---------- Coupons (storefront coupons + a couple of admin-only examples) ---------- */

const USAGE: Record<string, [number, number | null]> = {
  WELCOME10: [214, null],
  FIRSTORDER: [96, 500],
  SAVE15: [41, 300],
  FESTIVE20: [63, 250],
};

export const mockCoupons: AdminCoupon[] = [
  ...coupons.map((c, i) => ({
    ...c,
    id: `cp-${i + 1}`,
    active: true,
    usageCount: USAGE[c.code]?.[0] ?? 0,
    usageLimit: USAGE[c.code]?.[1] ?? null,
    startsAt: daysAgo(120 - i * 20),
    endsAt: c.code === "FESTIVE20" ? daysAgo(-30, 23, 59) : null,
  })),
  {
    id: "cp-5",
    code: "ONAM25",
    type: "percent",
    value: 25,
    minOrder: 2499,
    maxDiscount: 1200,
    description: "Onam special — 25% off on orders above ₹2,499 (up to ₹1,200)",
    active: false,
    usageCount: 188,
    usageLimit: 200,
    startsAt: daysAgo(80),
    endsAt: daysAgo(58, 23, 59),
  },
  {
    id: "cp-6",
    code: "KIDS150",
    type: "flat",
    value: 150,
    minOrder: 1199,
    description: "Flat ₹150 off kids' wear above ₹1,199",
    active: false,
    usageCount: 0,
    usageLimit: 150,
    startsAt: daysAgo(-7),
    endsAt: daysAgo(-37, 23, 59),
  },
];

export const mockOffers: AdminOffer[] = offers.map((o) => ({ ...o, active: true }));

/* ---------- Homepage ---------- */

export const mockBanners: HomepageBanner[] = [
  {
    id: "bn-1",
    placement: "hero",
    eyebrow: "New Season · Festive Edit",
    title: "Everyday elegance for every woman",
    subtitle: "Kurtis, dresses and festive wear — delivered across India.",
    ctaLabel: "Shop Now",
    ctaHref: "/shop",
    image: portrait(IMG.blushMaxiDress),
    active: true,
    startsAt: daysAgo(30),
    endsAt: null,
  },
  {
    id: "bn-2",
    placement: "hero",
    eyebrow: "Wedding Season",
    title: "Silk sarees with zari borders",
    subtitle: "Handpicked silks for weddings, receptions and temple visits.",
    ctaLabel: "Explore Sarees",
    ctaHref: "/categories/sarees",
    image: portrait(IMG.redSilkSaree),
    active: false,
    startsAt: daysAgo(-5),
    endsAt: daysAgo(-45),
  },
  {
    id: "bn-3",
    placement: "promo",
    eyebrow: "Limited Period",
    title: "Extra 20% off orders above ₹2,999",
    subtitle: "Use code FESTIVE20 at checkout.",
    ctaLabel: "Shop the Sale",
    ctaHref: "/shop?sort=featured",
    image: wide(IMG.boutique, "21:9"),
    active: true,
    startsAt: daysAgo(10),
    endsAt: daysAgo(-30),
  },
  {
    id: "bn-4",
    placement: "promo",
    eyebrow: "For the little ones",
    title: "Kids' festive kurtas are here",
    subtitle: "Comfy cotton kurtas and frocks for family functions.",
    ctaLabel: "Shop Kids",
    ctaHref: "/kids",
    image: wide(IMG.kidsGroup, "21:9"),
    active: true,
    startsAt: daysAgo(4),
    endsAt: null,
  },
];

export const mockFeaturedProductIds: string[] = getBestSellers(8).map((p) => p.id);

export const mockHomepageSections: HomepageSection[] = [
  { id: "audience", label: "Shop by audience", description: "Women · Men · Kids selector cards", visible: true },
  { id: "categories", label: "Category grid", description: "Popular categories with photos", visible: true },
  { id: "featured", label: "Featured collections", description: "The featured products you pick below", visible: true },
  { id: "promo", label: "Promotional banner", description: "Active promo banners", visible: true },
  { id: "why", label: "Why choose us", description: "Brand promises and trust points", visible: true },
  { id: "testimonials", label: "Testimonials", description: "Customer reviews carousel", visible: true },
  { id: "newsletter", label: "Newsletter sign-up", description: "Email capture at the bottom of the page", visible: false },
];
