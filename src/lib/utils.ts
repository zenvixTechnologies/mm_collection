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
  phone: "+91 94973 42612",
  whatsapp: "+91 94973 42612",
  address: "Near Thumpoly Church, Thumpoly P.O, Alappuzha, Kerala 688008",
  mapEmbed:
    "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d59842.75821526355!2d76.24201084863284!3d9.520344299999998!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3b088434d86ad845%3A0x4507fdbdd26e32ca!2sSt.%20Thomas%20Roman%20Catholic%20Church%20-%20Marian%20Pilgrimage%20Shrine%20Church%20(Thumpoly%20Church%2C%20Alappuzha)!5e1!3m2!1sen!2sin!4v1794459222357!5m2!1sen!2sin",
  mapLink: "https://www.google.com/maps/search/?api=1&query=Thumpoly+Church+Alappuzha",
  hours: "Mon – Sat, 10:00 AM – 8:00 PM",
};

export const FREE_SHIPPING_THRESHOLD = 999;
export const SHIPPING_FEE = 79;
