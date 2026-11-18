"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { AUDIENCES } from "@/data/audiences";
import { cn } from "@/lib/utils";
import { useActiveAudience, useAudienceStore } from "@/store/audience-store";

interface AudienceSwitcherProps {
  /** header: desktop nav · bar: full-width mobile strip · menu: inside the mobile drawer */
  variant: "header" | "bar" | "menu";
  className?: string;
}

const SHORT_LABEL = { header: "xl:hidden", bar: "sm:hidden", menu: "" } as const;
const FULL_LABEL = { header: "hidden xl:inline", bar: "hidden sm:inline", menu: "hidden" } as const;

/** Women / Men / Kids / Home & Living selector. The active audience gets a sliding pill. */
export function AudienceSwitcher({ variant, className }: AudienceSwitcherProps) {
  const active = useActiveAudience();
  const setAudience = useAudienceStore((s) => s.setAudience);

  return (
    <ul
      aria-label="Shop for"
      className={cn(
        "flex items-center rounded-full bg-sand p-1",
        variant === "header" && "gap-0.5",
        variant !== "header" && "w-full",
        className,
      )}
    >
      {AUDIENCES.map((a) => {
        const isActive = a.id === active;
        return (
          <li key={a.id} className={cn(variant !== "header" && "flex-1")}>
            <Link
              href={a.href}
              onClick={() => setAudience(a.id)}
              aria-current={isActive ? "page" : undefined}
              aria-label={a.shortLabel ? a.label : undefined}
              className={cn(
                "relative flex items-center justify-center rounded-full font-semibold whitespace-nowrap transition-colors",
                variant === "header" ? "h-9 px-3 text-[13.5px] tracking-wide xl:px-4" : "h-10 w-full px-1 text-sm",
                isActive ? "text-white" : "text-muted hover:text-ink",
              )}
            >
              {isActive && (
                <motion.span
                  layoutId={`audience-pill-${variant}`}
                  className="absolute inset-0 rounded-full bg-ink shadow-[0_4px_14px_rgb(34_34_34/0.18)]"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              {a.shortLabel ? (
                // Short label where space is tight: the narrow menu drawer, phones and the lg header.
                <span className="relative">
                  <span className={SHORT_LABEL[variant]}>{a.shortLabel}</span>
                  <span className={FULL_LABEL[variant]}>{a.label}</span>
                </span>
              ) : (
                <span className="relative">{a.label}</span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
