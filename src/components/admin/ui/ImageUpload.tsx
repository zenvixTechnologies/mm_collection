"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight, ImagePlus, Loader2, Star, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { errorMessage } from "@/lib/admin-api";
import { checkFile, uploadImage, type UploadPurpose } from "@/lib/admin-upload";
import { cn } from "@/lib/utils";
import { toast } from "@/store/ui-store";

/**
 * Image pickers for the admin. Files go straight from the browser to Cloudinary using a
 * one-time signature from our API, then the server verifies them; only the resulting URL is
 * passed to `onChange`.
 */

function pickFiles(list: FileList | null, max: number) {
  const files = Array.from(list ?? []).slice(0, max);
  const ok: File[] = [];
  for (const f of files) {
    const problem = checkFile(f);
    if (problem) toast.error(problem);
    else ok.push(f);
  }
  return ok;
}

/** Uploads files one by one; returns the URLs that succeeded and reports the ones that didn't. */
async function uploadAll(files: File[], purpose: UploadPurpose, ref: string | undefined) {
  const urls: string[] = [];
  for (const file of files) {
    try {
      urls.push((await uploadImage(file, purpose, ref)).url);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  return urls;
}

function Preview({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const local = src.startsWith("blob:") || src.startsWith("/");
  return <Image src={src} alt={alt} fill sizes="200px" unoptimized={local} className={cn("object-cover", className)} />;
}

function Uploading({ className, count = 1 }: { className?: string; count?: number }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-gold bg-gold-soft/60 text-center", className)} role="status">
      <Loader2 size={22} className="animate-spin text-gold-dark" aria-hidden />
      <span className="text-[13px] font-semibold text-ink">Uploading{count > 1 ? ` ${count} images` : ""}…</span>
    </div>
  );
}

interface DropZoneProps {
  onFiles: (files: File[]) => void;
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
        const files = pickFiles(e.dataTransfer.files, max);
        if (files.length) onFiles(files);
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
        accept="image/jpeg,image/png,image/webp,image/avif"
        multiple={max > 1}
        className="sr-only"
        onChange={(e) => {
          const files = pickFiles(e.target.files, max);
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
    </label>
  );
}

/** Several images; the first one is the primary (card) image. */
export function MultiImageUpload({
  images,
  onChange,
  max = 6,
  altBase,
  purpose = "product",
  uploadRef,
  reorder = false,
  onBusyChange,
}: {
  images: string[];
  onChange: (images: string[]) => void;
  max?: number;
  altBase: string;
  purpose?: UploadPurpose;
  /** Product slug — uploads are filed in that product's folder. */
  uploadRef?: string;
  /** Show buttons that move an image earlier or later. */
  reorder?: boolean;
  /** Told while uploads are still running. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const [uploading, setUploading] = useState(0);
  const busy = uploading > 0;
  const report = useRef(onBusyChange);
  report.current = onBusyChange;
  useEffect(() => {
    report.current?.(busy);
    return () => report.current?.(false);
  }, [busy]);
  const move = (from: number, to: number) => {
    const next = [...images];
    [next[from], next[to]] = [next[to], next[from]];
    onChange(next);
  };
  const remaining = max - images.length - uploading;
  // Keep the latest list for when uploads finish (the user may reorder or remove meanwhile).
  const latest = useRef(images);
  latest.current = images;

  const add = async (files: File[]) => {
    setUploading((n) => n + files.length);
    const urls = await uploadAll(files, purpose, uploadRef);
    setUploading((n) => n - files.length);
    if (urls.length) onChange([...latest.current, ...urls].slice(0, max));
  };

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
            <div className="absolute inset-x-1.5 bottom-1.5 flex flex-wrap justify-end gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
              {reorder && i > 0 && (
                <button type="button" onClick={() => move(i, i - 1)} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-ink shadow" aria-label={`Move ${altBase} image ${i + 1} earlier`}>
                  <ChevronLeft size={14} />
                </button>
              )}
              {reorder && i < images.length - 1 && (
                <button type="button" onClick={() => move(i, i + 1)} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-ink shadow" aria-label={`Move ${altBase} image ${i + 1} later`}>
                  <ChevronRight size={14} />
                </button>
              )}
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
        {uploading > 0 && (
          <li className="aspect-[4/5]">
            <Uploading className="h-full" count={uploading} />
          </li>
        )}
        {remaining > 0 && (
          <li className="aspect-[4/5]">
            <DropZone compact max={remaining} label="Add image" onFiles={add} className="h-full" />
          </li>
        )}
      </ul>
      <p className="mt-2 text-xs text-muted">
        Up to {max} images, 4:5 portrait works best. JPG, PNG, WebP or AVIF under 5 MB. Images upload securely to the store&apos;s image
        library; removed images are deleted when you save.
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
  purpose = "category",
}: {
  image: string | null;
  onChange: (image: string | null) => void;
  alt: string;
  aspect?: string;
  hint?: string;
  /** Show the whole image (logos) instead of cropping to fill. */
  contain?: boolean;
  purpose?: UploadPurpose;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const replace = async (files: File[]) => {
    if (!files[0]) return;
    setUploading(true);
    const [url] = await uploadAll([files[0]], purpose, undefined);
    setUploading(false);
    if (url) onChange(url);
  };

  if (uploading) return <Uploading className={aspect} />;
  if (!image) {
    return <DropZone max={1} label="Upload image" hint={hint ?? "Drag & drop or click to browse"} onFiles={replace} className={aspect} />;
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
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void replace(pickFiles(e.target.files, 1));
          e.target.value = "";
        }}
      />
    </div>
  );
}
