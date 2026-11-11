import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Brand logo — the official M&M COLLECTIONS emblem.
 * Sources are pre-sized from the original artwork (public/brand/logo-original.png)
 * at ~3× display size, so they stay crisp on high-density screens. They are served
 * as-is (unoptimized) to avoid any re-compression.
 */

type Size = "header" | "footer";

const SIZES: Record<Size, { src: string; className: string }> = {
  header: { src: "/brand/logo-192.webp", className: "h-12 w-12 lg:h-[60px] lg:w-[60px]" },
  footer: { src: "/brand/logo-320.webp", className: "h-24 w-24" },
};

interface LogoProps {
  className?: string;
  size?: Size;
  /** Show the "M&M COLLECTIONS" wordmark beside the emblem (header). */
  withWordmark?: boolean;
  /** Footer sits on a dark background: place the emblem on a white disc. */
  onDark?: boolean;
  priority?: boolean;
}

export function Logo({ className, size = "header", withWordmark = false, onDark = false, priority = false }: LogoProps) {
  const s = SIZES[size];
  return (
    <Link href="/" aria-label="M&M COLLECTIONS — home" className={cn("group inline-flex items-center gap-2.5", className)}>
      <span className={cn("relative block shrink-0 rounded-full", onDark && "bg-white p-1.5 shadow-[0_4px_24px_rgb(0_0_0/0.4)] ring-2 ring-gold/70")}>
        <Image
          src={s.src}
          alt="M&M COLLECTIONS logo"
          width={size === "header" ? 192 : 320}
          height={size === "header" ? 192 : 320}
          unoptimized
          priority={priority}
          className={cn(s.className, "object-contain transition-transform duration-300 group-hover:scale-[1.03]")}
        />
      </span>
      {withWordmark && (
        <span className="flex flex-col leading-none max-[359px]:hidden">
          <span className="font-display text-[22px] font-bold tracking-[0.03em] text-accent lg:text-[26px]">
            M<span className="text-gold-dark">&amp;</span>M
          </span>
          <span className="mt-0.5 text-[8px] font-bold tracking-[0.34em] text-ink lg:text-[9px]">COLLECTIONS</span>
        </span>
      )}
    </Link>
  );
}
