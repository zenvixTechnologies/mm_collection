import { describe, expect, it } from "vitest";
import { AUDIENCES, countLabel, getAudience, isAudience } from "@/data/audiences";
import { categories, categoryFullName, getCategoriesByAudience, getCategory } from "@/data/categories";
import { getProductsByAudience } from "@/data/products";
import { searchCategories } from "./catalog";

describe("main categories", () => {
  it("lists Women, Men, Kids, then Home & Living", () => {
    expect(AUDIENCES.map((a) => a.id)).toEqual(["women", "men", "kids", "home-living"]);
    expect(getAudience("home-living")).toMatchObject({ label: "Home & Living", href: "/home-living", kind: "home" });
  });

  it("recognises every main category id and rejects others", () => {
    for (const a of AUDIENCES) expect(isAudience(a.id)).toBe(true);
    expect(isAudience("home")).toBe(false);
    expect(isAudience("")).toBe(false);
  });

  it("keeps the existing Women / Men / Kids sub-categories unchanged", () => {
    expect(getCategoriesByAudience("women")).toHaveLength(12);
    expect(getCategoriesByAudience("men")).toHaveLength(8);
    expect(getCategoriesByAudience("kids")).toHaveLength(8);
  });

  it("has the four Home & Living sub-categories in order", () => {
    expect(getCategoriesByAudience("home-living").map((c) => c.name)).toEqual([
      "Bedsheets",
      "Pillow Covers",
      "Cushion Covers",
      "Blankets",
    ]);
    expect(getCategory("home-bedsheets")?.audience).toBe("home-living");
  });

  it("uses unique category slugs across the store", () => {
    expect(new Set(categories.map((c) => c.slug)).size).toBe(categories.length);
  });

  it("names Home & Living sub-categories without a prefix", () => {
    expect(categoryFullName(getCategory("home-pillow-covers")!)).toBe("Pillow Covers");
    expect(categoryFullName(getCategory("men-shirts")!)).toBe("Men's Shirts");
  });

  it("starts Home & Living with no invented products", () => {
    expect(getProductsByAudience("home-living")).toHaveLength(0);
  });

  it("counts clothing as styles and home products as products", () => {
    expect(countLabel(3, "women")).toBe("3 styles");
    expect(countLabel(1, "home-living")).toBe("1 product");
  });
});

describe("searchCategories", () => {
  it("finds a Home & Living sub-category by name, singular or plural", () => {
    expect(searchCategories("bedsheets").map((c) => c.id)).toEqual(["home-bedsheets"]);
    expect(searchCategories("blanket").map((c) => c.id)).toEqual(["home-blankets"]);
    expect(searchCategories("cushion cover").map((c) => c.id)).toEqual(["home-cushion-covers"]);
  });

  it("finds all Home & Living sub-categories from the main category's keywords", () => {
    expect(searchCategories("bedding").map((c) => c.audience)).toEqual(Array(4).fill("home-living"));
  });

  it("does not let 'men' match women's categories", () => {
    expect(searchCategories("men", 50).every((c) => c.audience === "men")).toBe(true);
  });

  it("ignores empty and single-letter queries", () => {
    expect(searchCategories("")).toEqual([]);
    expect(searchCategories("a")).toEqual([]);
  });
});
