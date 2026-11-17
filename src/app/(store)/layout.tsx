import { StoreChrome } from "@/components/layout/StoreChrome";

/** Customer-facing storefront. URLs are unchanged — "(store)" is a route group, not a path segment. */
export default function StoreLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <StoreChrome>{children}</StoreChrome>;
}
