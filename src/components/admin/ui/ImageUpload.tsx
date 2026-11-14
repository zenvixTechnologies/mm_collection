"use client";

import Image from "next/image";
import { ImagePlus, Star, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { toast } from "@/store/ui-store";

/**
 * DEMO UPLOAD — files are previewed locally with object URLs and never leave the browser.
 * When the API exists, upload the File here and store the returned URL instead.
 */
function readFiles(list: FileList | null, max: number) {
  const files = Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));
  const tooBig = files.filter((f) => f.size > 5 * 1024 * 1024);
  if (tooBig.length) toast.error("Images must be under 5 MB.");
  return files
    .filter((f) => f.size <= 5 * 1024 * 1024)
    .slice(0, max)
    .map((f) => URL.createObjectURL(f));
}

function Preview({ src, alt, className }: { src: string; alt: string; className?: string }) {
  // Blob/object URLs and local files are shown as-is; remote photos go through the image loader.
  const local = src.startsWith("blob:") || src.startsWith("/");
  return <Image src={src} alt={alt} fill sizes="200px" unoptimized={local} className={cn("object-cover", className)} />;
}

interface DropZoneProps {
  onFiles: (urls: string[]) => void;
  max: number;
  label: string;
  hint?: string;
  className?: string;
  compact?: boolean;
}

function DropZone({ onFiles, max, label, hint, className, compact }: DropZoneProps) {
  const id = useId();
  const [over, setOver] = useState(false);
  return (
    <label
      htmlFor={id}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const urls = readFiles(e.dataTransfer.files, max);
        if (urls.length) onFiles(urls);
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed text-center transition-colors",
        over ? "border-accent bg-accent-soft" : "border-line bg-canvas hover:border-gold hover:bg-gold-soft/60",
        compact ? "p-3" : "p-6",
        className,
      )}
    >
      <ImagePlus size={compact ? 20 : 24} className="text-gold-dark" aria-hidden />
      <span className="text-[13px] font-semibold text-ink">{label}</span>
      {hint && !compact && <span className="text-xs text-muted">{hint}</span>}
      <input
        id={id}
        type="file"
        accept="image/*"
        multiple={max > 1}
        className="sr-only"
        onChange={(e) => {
          const urls = readFiles(e.target.files, max);
          if (urls.length) onFiles(urls);
          e.target.value = "";
        }}
      />
    </label>
  );
}

/** Several images; the first one is the primary (card) image. */
export function MultiImageUpload({ images, onChange, max = 6, altBase }: { images: string[]; onChange: (images: string[]) => void; max?: number; altBase: string }) {
  const remaining = max - images.length;
  return (
    <div>
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {images.map((src, i) => (
          <li key={src} className="group relative aspect-[4/5] overflow-hidden rounded-xl border border-line bg-sand">
            <Preview src={src} alt={`${altBase} — image ${i + 1}`} />
            {i === 0 && (
              <span className="absolute top-1.5 left-1.5 rounded-full bg-royal/85 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-gold-light uppercase">
                Primary
              </span>
            )}
            <div className="absolute inset-x-1.5 bottom-1.5 flex justify-end gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
              {i > 0 && (
                <button
                  type="button"
                  onClick={() => onChange([src, ...images.filter((x) => x !== src)])}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-gold-dark shadow"
                  aria-label={`Make image ${i + 1} the primary image`}
                >
                  <Star size={14} />
                </button>
              )}
              <button
                type="button"
                onClick={() => onChange(images.filter((x) => x !== src))}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-danger shadow"
                aria-label={`Remove image ${i + 1}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </li>
        ))}
        {remaining > 0 && (
          <li className="aspect-[4/5]">
            <DropZone compact max={remaining} label="Add image" onFiles={(urls) => onChange([...images, ...urls])} className="h-full" />
          </li>
        )}
      </ul>
      <p className="mt-2 text-xs text-muted">
        Up to {max} images, 4:5 portrait works best. JPG, PNG or WebP under 5 MB. Previews stay on this device (demo).
      </p>
    </div>
  );
}

/** One image (banner, category, logo) with replace/remove. */
export function SingleImageUpload({
  image,
  onChange,
  alt,
  aspect = "aspect-[4/5]",
  hint,
  contain = false,
}: {
  image: string | null;
  onChange: (image: string | null) => void;
  alt: string;
  aspect?: string;
  hint?: string;
  /** Show the whole image (logos) instead of cropping to fill. */
  contain?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  if (!image) {
    return <DropZone max={1} label="Upload image" hint={hint ?? "Drag & drop or click to browse"} onFiles={(urls) => onChange(urls[0])} className={aspect} />;
  }
  return (
    <div className={cn("group relative overflow-hidden rounded-xl border border-line", contain ? "bg-white" : "bg-sand", aspect)}>
      <Preview src={image} alt={alt} className={contain ? "!object-contain p-3" : undefined} />
      <div className="absolute inset-x-2 bottom-2 flex justify-end gap-1.5">
        <button type="button" onClick={() => inputRef.current?.click()} className="btn-light btn-sm min-h-8 px-3 text-xs shadow">
          Replace
        </button>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-danger shadow"
          aria-label="Remove image"
        >
          <Trash2 size={14} />
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const [url] = readFiles(e.target.files, 1);
          if (url) onChange(url);
          e.target.value = "";
        }}
      />
    </div>
  );
}
