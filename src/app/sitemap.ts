import type { MetadataRoute } from "next";
import { categories } from "@/data/categories";
import { products } from "@/data/products";
import { SITE } from "@/lib/utils";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const staticRoutes = [
    "",
    "/women",
    "/men",
    "/kids",
    "/shop",
    "/categories",
    "/new-arrivals",
    "/best-sellers",
    "/about",
    "/contact",
    "/track-order",
    "/shipping-policy",
    "/return-policy",
    "/privacy-policy",
    "/terms",
  ];
  return [
    ...staticRoutes.map((r) => ({ url: `${SITE.url}${r}`, lastModified: now, priority: r === "" ? 1 : 0.7 })),
    ...categories.map((c) => ({ url: `${SITE.url}/categories/${c.slug}`, lastModified: now, priority: 0.8 })),
    ...products.map((p) => ({ url: `${SITE.url}/product/${p.slug}`, lastModified: now, priority: 0.6 })),
  ];
}
