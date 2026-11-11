"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Heart } from "lucide-react";
import { useHydrated } from "@/hooks/use-hydrated";
import { cn } from "@/lib/utils";
import { toast } from "@/store/ui-store";
import { useWishlistStore } from "@/store/wishlist-store";

interface WishlistButtonProps {
  productId: string;
  productName: string;
  className?: string;
  variant?: "floating" | "outline";
}

export function WishlistButton({ productId, productName, className, variant = "floating" }: WishlistButtonProps) {
  const hydrated = useHydrated();
  const active = useWishlistStore((s) => s.ids.includes(productId)) && hydrated;
  const toggle = useWishlistStore((s) => s.toggle);

  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const added = toggle(productId);
    if (added) toast.success(`Saved to wishlist`, { label: "View", href: "/wishlist" });
    else toast.info(`Removed from wishlist`);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={active ? `Remove ${productName} from wishlist` : `Add ${productName} to wishlist`}
      className={cn(
        "flex items-center justify-center transition-colors",
        variant === "floating" &&
          "h-9 w-9 rounded-full bg-white/90 text-ink shadow-sm backdrop-blur hover:bg-white",
        variant === "outline" && "relative h-12 w-12 shrink-0 rounded-full border border-line bg-white hover:border-ink",
        className,
      )}
    >
      <motion.span
        key={active ? "on" : "off"}
        initial={{ scale: 0.6 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 520, damping: 14 }}
        className="flex"
      >
        <Heart
          size={variant === "outline" ? 20 : 17}
          className={active ? "text-accent" : "text-ink"}
          fill={active ? "currentColor" : "none"}
        />
      </motion.span>
      <AnimatePresence>
        {active && (
          <motion.span
            initial={{ scale: 0.4, opacity: 0.6 }}
            animate={{ scale: 1.9, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="pointer-events-none absolute inset-0 rounded-full border-2 border-accent"
            aria-hidden
          />
        )}
      </AnimatePresence>
    </button>
  );
}
