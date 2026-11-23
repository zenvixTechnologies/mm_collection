"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createCatalog, type Catalog, type CatalogSnapshot } from "@/lib/catalog-query";

const CatalogContext = createContext<Catalog | null>(null);

/**
 * Makes the MongoDB catalogue (loaded once by the store layout) available to client components
 * that look products up synchronously — cart lines, quick add, search, header menus.
 */
export function CatalogProvider({ snapshot, children }: { snapshot: CatalogSnapshot; children: ReactNode }) {
  const catalog = useMemo(() => createCatalog(snapshot), [snapshot]);
  return <CatalogContext.Provider value={catalog}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): Catalog {
  const catalog = useContext(CatalogContext);
  if (!catalog) throw new Error("useCatalog must be used inside <CatalogProvider>");
  return catalog;
}
