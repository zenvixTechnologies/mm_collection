"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Audience } from "@/types";
import { DEFAULT_AUDIENCE, isAudience } from "@/data/audiences";
import { useCatalog } from "@/components/catalog/CatalogProvider";
import type { Catalog } from "@/lib/catalog-query";
import { useHydrated } from "@/hooks/use-hydrated";

/**
 * The audience (Women / Men / Kids) the shopper is browsing.
 * Kept per tab in sessionStorage: it follows the shopper around the site but a new visit
 * always starts on the Women-first experience.
 */
interface AudienceState {
  audience: Audience;
  setAudience: (audience: Audience) => void;
}

export const useAudienceStore = create<AudienceState>()(
  persist(
    (set) => ({
      audience: DEFAULT_AUDIENCE,
      setAudience: (audience) => set({ audience }),
    }),
    {
      name: "mm-audience",
      storage: createJSONStorage(() => sessionStorage),
      merge: (persisted, current) => {
        const saved = (persisted as Partial<AudienceState> | undefined)?.audience;
        return { ...current, audience: isAudience(saved) ? saved : DEFAULT_AUDIENCE };
      },
    },
  ),
);

/** Audience implied by the URL alone — null on neutral pages such as the cart or checkout. */
export function audienceFromPath(pathname: string, catalog: Pick<Catalog, "getCategory" | "getProductBySlug">): Audience | null {
  if (pathname === "/") return "women";
  const [, first, second] = pathname.split("/");
  if (isAudience(first)) return first;
  if (first === "categories" && second) return catalog.getCategory(second)?.audience ?? null;
  if (first === "product" && second) return catalog.getProductBySlug(second)?.audienceCategory ?? null;
  return null;
}

/**
 * The audience to highlight right now: what the current page is about, or — on neutral
 * pages like the bag — the one the shopper was last browsing.
 */
export function useActiveAudience(): Audience {
  const pathname = usePathname();
  const hydrated = useHydrated();
  const stored = useAudienceStore((s) => s.audience);
  const catalog = useCatalog();
  // Before hydration the server can't know sessionStorage — render the default so markup matches.
  return audienceFromPath(pathname, catalog) ?? (hydrated ? stored : DEFAULT_AUDIENCE);
}

/** Mounted once in the layout: remembers the audience of every audience-specific page visited. */
export function AudienceTracker() {
  const pathname = usePathname();
  const setAudience = useAudienceStore((s) => s.setAudience);
  const catalog = useCatalog();
  useEffect(() => {
    const fromPath = audienceFromPath(pathname, catalog);
    if (fromPath) setAudience(fromPath);
  }, [pathname, setAudience, catalog]);
  return null;
}
