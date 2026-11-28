"use client";

import { AlertTriangle } from "lucide-react";
import { useRef, useState } from "react";
import { MAX_COLOR_IMAGES, colorGallery, colorsWithoutPhotos } from "@/lib/gallery";
import { cn } from "@/lib/utils";
import type { ProductColor } from "@/types";
import { MultiImageUpload } from "../ui/ImageUpload";

/**
 * One photo gallery per colour. Every colour's uploader stays mounted (only the selected one is
 * shown), so an upload that finishes after switching colours still lands in the colour it was
 * started for.
 */
export function ColourPhotos({
  colors,
  colorImages,
  productName,
  uploadRef,
  onChange,
  onBusyChange,
}: {
  colors: ProductColor[];
  colorImages: { color: string; images: string[] }[];
  productName: string;
  uploadRef?: string;
  onChange: (color: string, images: string[]) => void;
  /** True while any colour is still uploading. */
  onBusyChange: (busy: boolean) => void;
}) {
  const [selected, setSelected] = useState(colors[0]?.name ?? "");
  const active = colors.some((c) => c.name === selected) ? selected : (colors[0]?.name ?? "");
  const uploading = useRef(new Set<string>());
  const reportBusy = (color: string, busy: boolean) => {
    if (busy) uploading.current.add(color);
    else uploading.current.delete(color);
    onBusyChange(uploading.current.size > 0);
  };
  const product = { colors, colorImages };
  const missing = colorsWithoutPhotos(product);

  return (
    <div className="space-y-3">
      {colors.length > 1 && missing.length > 0 && (
        <p className="flex items-start gap-2 rounded-xl bg-gold-soft px-4 py-3 text-[13px] leading-5 text-ink" role="alert">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-gold-dark" aria-hidden />
          <span>
            {missing.length === colors.length ? "No colour has its own photos yet." : `No photos yet for: ${missing.join(", ")}.`} Shoppers who choose{" "}
            {missing.length === 1 ? "that colour" : "those colours"} see the general product photos, with a note that they may show another colour.
          </span>
        </p>
      )}

      <div role="tablist" aria-label="Colour to add photos for" className="flex flex-wrap gap-2">
        {colors.map((c) => {
          const count = colorGallery(product, c.name).length;
          const on = c.name === active;
          return (
            <button
              key={c.name}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setSelected(c.name)}
              className={cn("inline-flex items-center gap-2 rounded-full border py-1.5 pr-3 pl-2 text-sm font-medium transition-colors", on ? "border-ink bg-ink text-white" : "border-line bg-white text-ink hover:border-ink")}
            >
              <span className="h-4 w-4 rounded-full ring-1 ring-ink/10" style={{ background: c.hex }} aria-hidden />
              {c.name}
              <span className={cn("rounded-full px-1.5 text-[11px] font-semibold tabular-nums", count ? (on ? "bg-white/20" : "bg-sand") : "bg-gold text-royal")}>{count || "none"}</span>
            </button>
          );
        })}
      </div>

      {colors.map((c) => (
        <div key={c.name} role="tabpanel" aria-label={`${c.name} photos`} hidden={c.name !== active}>
          <p className="field-label">{c.name} photos</p>
          <MultiImageUpload
            images={colorGallery(product, c.name)}
            onChange={(images) => onChange(c.name, images)}
            max={MAX_COLOR_IMAGES}
            altBase={`${productName}, ${c.name}`}
            purpose="product"
            uploadRef={uploadRef}
            reorder
            onBusyChange={(busy) => reportBusy(c.name, busy)}
          />
        </div>
      ))}
    </div>
  );
}
