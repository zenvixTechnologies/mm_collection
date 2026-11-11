import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Defaults to ".next". Set NEXT_DIST_DIR to build somewhere else, e.g. to run a
  // production build check without disturbing a running `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  images: {
    // Product photography is served from Unsplash's image CDN, which resizes on the fly.
    loader: "custom",
    loaderFile: "./src/lib/image-loader.ts",
    remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com" }],
  },
};

export default nextConfig;
