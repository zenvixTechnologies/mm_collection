import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, DM_Sans } from "next/font/google";
import { Suspense } from "react";
import { AnnouncementBar } from "@/components/layout/AnnouncementBar";
import { CartDrawer } from "@/components/layout/CartDrawer";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { MobileMenu } from "@/components/layout/MobileMenu";
import { Providers } from "@/components/layout/Providers";
import { RouteProgress } from "@/components/layout/RouteProgress";
import { SplashController } from "@/components/layout/SplashController";
import { SplashScreen } from "@/components/layout/SplashScreen";
import { SearchOverlay } from "@/components/layout/SearchOverlay";
import { QuickAddModal } from "@/components/products/QuickAddModal";
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
    default: `${SITE.name} — Ladies' Fashion: Kurtis, Dresses & Ethnic Wear`,
    template: `%s | ${SITE.name}`,
  },
  description:
    "Shop women's dresses, kurtis, churidhars, sarees, co-ord sets, party wear, nightwear and feeding wear at M&M COLLECTIONS. Free delivery over ₹999 and easy returns.",
  applicationName: SITE.name,
  keywords: ["M&M COLLECTIONS", "ladies fashion", "kurtis", "dresses", "churidhar", "sarees", "feeding wear", "women clothing India"],
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
        <SplashScreen />
        <Providers>
          <SplashController />
          <Suspense fallback={null}>
            <RouteProgress />
          </Suspense>
          <a
            href="#main"
            className="sr-only z-[100] rounded-full bg-ink px-4 py-2 text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
          >
            Skip to content
          </a>
          <AnnouncementBar />
          <Header />
          <main id="main" className="min-h-[60vh]">
            {children}
          </main>
          <Footer />
          <CartDrawer />
          <SearchOverlay />
          <MobileMenu />
          <QuickAddModal />
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
