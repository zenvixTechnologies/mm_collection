"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface QuantitySelectorProps {
  value: number;
  max: number;
  min?: number;
  onChange: (value: number) => void;
  size?: "sm" | "md";
  label?: string;
}

export function QuantitySelector({ value, max, min = 1, onChange, size = "md", label = "Quantity" }: QuantitySelectorProps) {
  const dim = size === "sm" ? "h-9 w-9" : "h-11 w-11";
  return (
    <div
      className="inline-flex items-center rounded-full border border-line bg-white"
      role="group"
      aria-label={label}
    >
      <button
        type="button"
        className={cn(dim, "flex items-center justify-center rounded-full text-ink transition-colors hover:bg-sand disabled:opacity-35 disabled:hover:bg-transparent")}
        onClick={() => onChange(value - 1)}
        disabled={value <= min}
        aria-label="Decrease quantity"
      >
        <Minus size={15} />
      </button>
      <output className={cn("min-w-8 text-center font-semibold tabular-nums", size === "sm" ? "text-sm" : "text-[15px]")} aria-live="polite">
        {value}
      </output>
      <button
        type="button"
        className={cn(dim, "flex items-center justify-center rounded-full text-ink transition-colors hover:bg-sand disabled:opacity-35 disabled:hover:bg-transparent")}
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        aria-label="Increase quantity"
      >
        <Plus size={15} />
      </button>
    </div>
  );
}
