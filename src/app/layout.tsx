import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, DM_Sans } from "next/font/google";
import { Suspense } from "react";
import { Providers } from "@/components/layout/Providers";
import { RouteProgress } from "@/components/layout/RouteProgress";
import { Toaster } from "@/components/ui/Toaster";
import { SITE } from "@/lib/utils";
import "./globals.css";

const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans", display: "swap" });
const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-cormorant",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.name} — Women's Fashion, plus Men & Kids: Kurtis, Dresses & Ethnic Wear`,
    template: `%s | ${SITE.name}`,
  },
  description:
    "Shop women's dresses, kurtis, churidhars, sarees, co-ord sets, party wear and feeding wear — plus men's and kids' clothing — at M&M COLLECTIONS. Delivered across India with easy returns.",
  applicationName: SITE.name,
  keywords: ["M&M COLLECTIONS", "ladies fashion", "kurtis", "dresses", "churidhar", "sarees", "feeding wear", "women clothing India", "men's clothing", "kids clothing"],
  openGraph: {
    type: "website",
    siteName: SITE.name,
    locale: "en_IN",
    title: `${SITE.name} — Ladies' Fashion`,
    description: "Everyday elegance for every woman. Kurtis, dresses, festive wear and more.",
  },
  twitter: { card: "summary_large_image" },
  // Favicon, Apple touch icon and social share image come from the brand logo:
  // src/app/icon.png, src/app/apple-icon.png, src/app/opengraph-image.jpg
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-IN" className={`${dmSans.variable} ${cormorant.variable}`} suppressHydrationWarning>
      <body>
        <Providers>
          <Suspense fallback={null}>
            <RouteProgress />
          </Suspense>
          {/* Storefront chrome lives in app/(store)/layout.tsx; the admin panel has its own in app/admin */}
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
