import { describe, expect, it } from "vitest";
import { products } from "@/data/products";
import { DELIVERY_ZONES, formatDeliveryZone, isUndergarment } from "./policies";

const item = (name: string) => ({ name, categoryId: "nightwear" as const });

describe("isUndergarment", () => {
  it.each(["Cotton Nursing Bra", "Seamless Panties (Pack of 3)", "Men's Cotton Briefs", "Lace Lingerie Set", "Everyday Innerwear Vest", "Men's Boxer Shorts"])(
    "flags %s",
    (name) => expect(isUndergarment(item(name))).toBe(true),
  );

  it.each(["Red Floral Slip Dress", "Brass Button Kurti", "Cotton Nightwear Set", "Premium Feeding Frock", "Embroidered Brocade Saree"])(
    "does not flag %s",
    (name) => expect(isUndergarment(item(name))).toBe(false),
  );

  it("does not flag any current catalogue product", () => {
    expect(products.filter(isUndergarment).map((p) => p.name)).toEqual([]);
  });
});

describe("delivery zones", () => {
  it("lists the published timelines", () => {
    expect(DELIVERY_ZONES.map((z) => `${z.region}: ${formatDeliveryZone(z)}`)).toEqual([
      "Within Kerala: 3–5 business days",
      "South India: 5–7 business days",
      "Rest of India: 7–10 business days",
    ]);
  });
});
