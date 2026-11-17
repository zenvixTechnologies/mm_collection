import type { ReactNode } from "react";
import { AnnouncementBar } from "./AnnouncementBar";
import { AudienceBar } from "./AudienceBar";
import { CartDrawer } from "./CartDrawer";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { MobileMenu } from "./MobileMenu";
import { SearchOverlay } from "./SearchOverlay";
import { IntroGate } from "@/components/home/IntroGate";
import { QuickAddModal } from "@/components/products/QuickAddModal";
import { AudienceTracker } from "@/store/audience-store";

/**
 * Everything the customer-facing storefront wraps around a page: brand intro,
 * announcement bar, header, footer and the global drawers/overlays.
 * Used by the (store) route-group layout and by the root 404 page — never by /admin.
 */
export function StoreChrome({ children }: { children: ReactNode }) {
  return (
    <>
      {/* Brand intro: plays once per session, only when landing on the homepage */}
      <IntroGate />
      <a
        href="#main"
        className="sr-only z-[100] rounded-full bg-ink px-4 py-2 text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <AnnouncementBar />
      <Header />
      <AudienceBar />
      <AudienceTracker />
      <main id="main" className="min-h-[60vh]">
        {children}
      </main>
      <Footer />
      <CartDrawer />
      <SearchOverlay />
      <MobileMenu />
      <QuickAddModal />
    </>
  );
}
