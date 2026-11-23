import { describe, expect, it } from "vitest";
import { products } from "@/data/products";
import { buildVariants, publishedAtFor, skuCode } from "./legacy-import";

describe("buildVariants", () => {
  it("creates one variant per size × colour and preserves total stock exactly", () => {
    for (const p of products) {
      const v = buildVariants(p);
      expect(v).toHaveLength(Math.max(1, p.sizes.length) * Math.max(1, p.colors.length));
      expect(v.reduce((n, x) => n + x.stock, 0)).toBe(p.stock);
      expect(new Set(v.map((x) => x.sku)).size).toBe(v.length);
      expect(v.every((x) => Number.isInteger(x.pricePaise) && x.mrpPaise >= x.pricePaise)).toBe(true);
    }
  });

  it("produces globally unique variant SKUs across the whole catalogue", () => {
    const all = products.flatMap((p) => buildVariants(p).map((v) => v.sku));
    expect(new Set(all).size).toBe(all.length);
  });

  it("handles home sizes", () => {
    expect(skuCode("16 × 16 in")).toBe("1616IN");
    expect(skuCode("Blush Pink")).toBe("BLUSHPINK");
  });

  it("keeps list order as publish order", () => {
    const anchor = new Date("2026-11-01T00:00:00Z");
    expect(publishedAtFor(0, 3, anchor) < publishedAtFor(2, 3, anchor)).toBe(true);
    expect(publishedAtFor(2, 3, anchor).getTime()).toBe(anchor.getTime());
  });
});
