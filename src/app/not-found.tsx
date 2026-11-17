import { StoreChrome } from "@/components/layout/StoreChrome";
import StoreNotFound from "./(store)/not-found";

/** Unmatched URLs render outside every route group, so add the storefront chrome back here. */
export default function NotFound() {
  return (
    <StoreChrome>
      <StoreNotFound />
    </StoreChrome>
  );
}
