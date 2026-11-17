import type { MetadataRoute } from "next";
import { SITE } from "@/lib/utils";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/cart", "/checkout", "/order-success", "/account", "/wishlist", "/login", "/register", "/search"],
    },
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
