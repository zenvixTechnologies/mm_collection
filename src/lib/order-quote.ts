import type { CartTotals, OrderItem, Product, Size } from "@/types";
import { getProductById } from "@/data/products";
import { calculateTotals } from "./pricing";

/** What the browser is allowed to tell us about a line: which item, which variant, how many. Never the price. */
export interface QuoteLineInput {
  productId: string;
  size: Size | null;
  color: string | null;
  quantity: number;
}

export type OrderQuote =
  | { ok: true; items: OrderItem[]; totals: CartTotals; couponCode: string | null }
  | { ok: false; error: string };

const MAX_LINES = 50;
const MAX_QTY = 20;

function parseLines(input: unknown): QuoteLineInput[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_LINES) return null;
  const lines: QuoteLineInput[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.productId !== "string") return null;
    if (!Number.isInteger(r.quantity) || (r.quantity as number) < 1 || (r.quantity as number) > MAX_QTY) return null;
    lines.push({
      productId: r.productId,
      size: typeof r.size === "string" ? (r.size as Size) : null,
      color: typeof r.color === "string" ? r.color : null,
      quantity: r.quantity as number,
    });
  }
  return lines;
}

/**
 * Re-prices an order on the server from the product catalogue. Prices, discounts and totals sent
 * by the browser are ignored; only product IDs, variants, quantities and the coupon code are used.
 * Shipping charges are applicable but not calculated yet, so the total excludes shipping.
 */
export function quoteOrder(
  rawLines: unknown,
  rawCoupon: unknown,
  lookup: (id: string) => Product | undefined = getProductById,
): OrderQuote {
  const lines = parseLines(rawLines);
  if (!lines) return { ok: false, error: "Your bag looks invalid. Please refresh and try again." };

  const items: OrderItem[] = [];
  const unitsPerProduct = new Map<string, number>();
  for (const l of lines) {
    const p = lookup(l.productId);
    if (!p) return { ok: false, error: "An item in your bag is no longer available." };
    if (p.sizes.length ? !l.size || !p.sizes.includes(l.size) : l.size !== null) {
      return { ok: false, error: `Please choose a valid size for ${p.name}.` };
    }
    if (p.colors.length ? !l.color || !p.colors.some((c) => c.name === l.color) : l.color !== null) {
      return { ok: false, error: `Please choose a valid colour for ${p.name}.` };
    }
    const units = (unitsPerProduct.get(p.id) ?? 0) + l.quantity;
    if (units > p.stock) {
      return { ok: false, error: p.stock > 0 ? `Only ${p.stock} of ${p.name} left in stock.` : `${p.name} is out of stock.` };
    }
    unitsPerProduct.set(p.id, units);
    items.push({
      productId: p.id,
      audience: p.audienceCategory,
      slug: p.slug,
      name: p.name,
      image: p.images[0],
      price: p.price,
      size: l.size,
      color: l.color,
      quantity: l.quantity,
    });
  }

  const couponCode = typeof rawCoupon === "string" && rawCoupon.trim() ? rawCoupon.trim().toUpperCase().slice(0, 40) : null;
  const totals = calculateTotals(
    items.map((i) => ({ price: i.price, quantity: i.quantity, originalPrice: lookup(i.productId)?.originalPrice })),
    couponCode,
  );
  if (totals.total < 1) return { ok: false, error: "Order total must be at least ₹1." };

  return { ok: true, items, totals, couponCode: totals.couponDiscount > 0 ? couponCode : null };
}

/** Rupees → paise, the unit Razorpay works in. Prices are whole rupees in this store. */
export function toPaise(rupees: number) {
  return Math.round(rupees * 100);
}
