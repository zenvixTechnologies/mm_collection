"use client";

import { Check } from "lucide-react";
import type { Product, Size } from "@/types";
import { cn } from "@/lib/utils";
import type { PurchaseErrors } from "@/hooks/use-purchase";

interface VariantPickerProps {
  product: Product;
  size: Size | null;
  color: string | null;
  onSize: (s: Size) => void;
  onColor: (c: string) => void;
  errors: PurchaseErrors;
  onSizeGuide?: () => void;
  idPrefix: string;
}

export function VariantPicker({ product, size, color, onSize, onColor, errors, onSizeGuide, idPrefix }: VariantPickerProps) {
  return (
    <div className="space-y-6">
      {/* Colour */}
      <fieldset aria-describedby={errors.color ? `${idPrefix}-color-error` : undefined}>
        <legend className="mb-2.5 text-sm">
          <span className="font-semibold">Colour</span>
          <span className="text-muted">{color ? `: ${color}` : product.colors.length > 1 ? " — select one" : ""}</span>
        </legend>
        <div className="flex flex-wrap gap-2.5">
          {product.colors.map((c) => {
            const selected = color === c.name;
            return (
              <label
                key={c.name}
                className={cn(
                  "relative flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border-2 transition-all",
                  selected ? "border-ink" : "border-transparent hover:border-line",
                  errors.color && !selected && "border-danger/40",
                )}
                title={c.name}
              >
                <input
                  type="radio"
                  name={`${idPrefix}-color`}
                  value={c.name}
                  checked={selected}
                  onChange={() => onColor(c.name)}
                  className="peer sr-only"
                  aria-label={c.name}
                />
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-black/10 peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2"
                  style={{ backgroundColor: c.hex }}
                >
                  {selected && <Check size={15} className={isLight(c.hex) ? "text-ink" : "text-white"} />}
                </span>
              </label>
            );
          })}
        </div>
        {errors.color && (
          <p id={`${idPrefix}-color-error`} className="field-error" role="alert">
            {errors.color}
          </p>
        )}
      </fieldset>

      {/* Size */}
      <fieldset aria-describedby={errors.size ? `${idPrefix}-size-error` : undefined}>
        <div className="mb-2.5 flex items-center justify-between">
          <legend className="text-sm">
            <span className="font-semibold">Size</span>
            <span className="text-muted">{size ? `: ${size}` : " — select one"}</span>
          </legend>
          {onSizeGuide && product.sizes[0] !== "Free Size" && (
            <button type="button" onClick={onSizeGuide} className="text-sm font-medium text-ink underline underline-offset-4 hover:text-accent">
              Size guide
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {product.sizes.map((s) => {
            const selected = size === s;
            return (
              <label key={s} className="cursor-pointer">
                <input
                  type="radio"
                  name={`${idPrefix}-size`}
                  value={s}
                  checked={selected}
                  onChange={() => onSize(s)}
                  className="peer sr-only"
                />
                <span
                  className={cn(
                    "flex h-11 min-w-12 items-center justify-center rounded-full border px-4 text-sm font-medium transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2",
                    selected ? "border-ink bg-ink text-white" : "border-line bg-white text-ink hover:border-ink",
                    errors.size && !selected && "border-danger/50",
                  )}
                >
                  {s}
                </span>
              </label>
            );
          })}
        </div>
        {errors.size && (
          <p id={`${idPrefix}-size-error`} className="field-error" role="alert">
            {errors.size}
          </p>
        )}
      </fieldset>
    </div>
  );
}

function isLight(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return r * 0.299 + g * 0.587 + b * 0.114 > 170;
}
