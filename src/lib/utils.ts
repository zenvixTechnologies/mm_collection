import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function formatPrice(value: number) {
  return inr.format(Math.round(value));
}

export function formatDate(iso: string, withTime = false) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

export function discountPercent(original: number, price: number) {
  if (original <= price) return 0;
  return Math.round(((original - price) / original) * 100);
}

export function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function cartKey(productId: string, size: string | null, color: string | null) {
  return [productId, size ?? "-", color ?? "-"].join("|");
}

export function generateOrderId() {
  const stamp = Date.now().toString(36).toUpperCase().slice(-5);
  const rand = Math.random().toString(36).toUpperCase().slice(2, 5);
  return `MM${stamp}${rand}`;
}

export const SITE = {
  name: "M&M COLLECTIONS",
  shortName: "M&M",
  tagline: "Everyday elegance for every woman",
  url: "https://mmcollections.in",
  email: "hello@mmcollections.in",
  phone: "+91 98765 43210",
  whatsapp: "+91 98765 43210",
  address: "Ground Floor, Rose Arcade, MG Road, Kochi, Kerala 682016",
  hours: "Mon – Sat, 10:00 AM – 8:00 PM",
};

export const FREE_SHIPPING_THRESHOLD = 999;
export const SHIPPING_FEE = 79;
