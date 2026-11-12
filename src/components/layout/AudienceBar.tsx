"use client";

import { usePathname } from "next/navigation";
import { AudienceSwitcher } from "./AudienceSwitcher";

/** Paths where switching audience would only distract (finishing a purchase). */
const HIDDEN_ON = ["/checkout", "/order-success"];

/**
 * Compact Women / Men / Kids selector for phones and tablets, just below the header.
 * It scrolls away with the page so the sticky header (and sticky shop toolbars) stay the same height.
 */
export function AudienceBar() {
  const pathname = usePathname();
  if (HIDDEN_ON.some((p) => pathname.startsWith(p))) return null;
  return (
    <div className="border-b border-line bg-white lg:hidden">
      <div className="container-page py-2">
        <AudienceSwitcher variant="bar" />
      </div>
    </div>
  );
}
