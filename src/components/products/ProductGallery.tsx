"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, ZoomIn } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FALLBACK_IMAGE } from "@/data/images";
import { useHydrated } from "@/hooks/use-hydrated";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/ui/Dialog";
import { ProductImage } from "@/components/ui/ProductImage";
import { ColourInfoButton } from "./ColourDisclaimer";

const VIEW_LABELS = ["Front view", "Detail close-up", "Fabric close-up", "Additional view"];

export function ProductGallery({ images: given, name, galleryKey = "", notice = null }: { images: string[]; name: string; galleryKey?: string; notice?: string | null }) {
  const images = given.length ? given : [FALLBACK_IMAGE];
  const [chosen, setIndex] = useState(0);
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  // A different colour starts again at its first photo. Adjusted during render, so no frame shows
  // the old position.
  const [shownKey, setShownKey] = useState(galleryKey);
  if (shownKey !== galleryKey) {
    setShownKey(galleryKey);
    setIndex(0);
    setZoom(null);
  }
  const index = shownKey === galleryKey && chosen < images.length ? chosen : 0;
  const [lightbox, setLightbox] = useState(false);
  const touchX = useRef<number | null>(null);
  const hydrated = useHydrated();

  const go = (d: number) => setIndex((i) => (i + d + images.length) % images.length);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setZoom({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
  };

  return (
    // Desktop: the photo keeps its 4:5 shape, so its width is capped to make it fit below the sticky
    // header (100px = thumbnail column + gap; 7rem = header offset + breathing room).
    <div className="lg:mx-auto lg:grid lg:w-full lg:max-w-[calc((100dvh-7rem)*0.8+100px)] lg:grid-cols-[84px_1fr] lg:gap-4">
      {/* Thumbnails (desktop) */}
      <ul className="hidden flex-col gap-3 lg:flex" aria-label="Product images">
        {images.map((src, i) => (
          <li key={src}>
            <button
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Show ${VIEW_LABELS[i] ?? `image ${i + 1}`}`}
              aria-current={i === index}
              className={cn(
                "relative block aspect-[4/5] w-full overflow-hidden rounded-lg border-2 bg-sand transition-all",
                i === index ? "border-ink" : "border-transparent opacity-70 hover:opacity-100",
              )}
            >
              <ProductImage src={src} alt="" fill sizes="84px" />
            </button>
          </li>
        ))}
      </ul>

      {/* Positioned so the colour-info button can sit over the photo without triggering zoom or the lightbox. */}
      <div className="relative">
        <div
          className="group relative aspect-[4/5] cursor-zoom-in overflow-hidden rounded-2xl bg-sand"
          onMouseMove={onMove}
          onMouseLeave={() => setZoom(null)}
          onClick={() => setLightbox(true)}
          onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
          onTouchEnd={(e) => {
            if (touchX.current === null) return;
            const dx = e.changedTouches[0].clientX - touchX.current;
            if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
            touchX.current = null;
          }}
        >
          {/* Keyed by colour: the previous colour's photo is removed at once, not faded out. */}
          <AnimatePresence key={galleryKey} initial={false} mode="popLayout">
            <motion.div
              key={images[index]}
              className="absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <ProductImage
                src={images[index]}
                alt={`${name} — ${VIEW_LABELS[index] ?? `image ${index + 1}`}`}
                fill
                priority={index === 0}
                sizes="(min-width: 1024px) 50vw, 100vw"
                className="transition-transform duration-200 ease-out"
                style={
                  zoom
                    ? { transform: "scale(1.9)", transformOrigin: `${zoom.x}% ${zoom.y}%` }
                    : { transform: "scale(1)" }
                }
              />
            </motion.div>
          </AnimatePresence>

          <span className="pointer-events-none absolute right-3 bottom-3 hidden items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-xs font-medium text-ink shadow-sm transition-opacity group-hover:opacity-0 lg:flex">
            <ZoomIn size={14} /> Hover to zoom
          </span>

          {/* Mobile arrows + dots */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
            className="absolute top-1/2 left-3 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 shadow-sm lg:hidden"
            aria-label="Previous image"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            className="absolute top-1/2 right-3 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 shadow-sm lg:hidden"
            aria-label="Next image"
          >
            <ChevronRight size={18} />
          </button>
          <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5 lg:hidden" aria-hidden>
            {images.map((src, i) => (
              <span key={src} className={cn("h-1.5 rounded-full transition-all", i === index ? "w-5 bg-ink" : "w-1.5 bg-ink/30")} />
            ))}
          </div>
        </div>
        <ColourInfoButton />
        <p className="sr-only" aria-live="polite">
          Image {index + 1} of {images.length}
        </p>
        {notice && (
          <p className="mt-3 rounded-xl bg-gold-soft px-4 py-2.5 text-[13px] leading-5 text-ink" role="status">
            {notice}
          </p>
        )}
      </div>

      {/* Rendered on <body>: inside the sticky gallery column its z-index couldn't rise above the header or the page. */}
      {hydrated &&
        createPortal(
          <Dialog open={lightbox} onClose={() => setLightbox(false)} title={name} variant="center" className="max-w-[min(48rem,calc((100dvh-7rem)*0.8))]!">
            <div className="relative aspect-[4/5] max-h-[calc(100dvh-7rem)] w-full bg-sand">
              <ProductImage src={images[index]} alt={`${name} — enlarged`} fill sizes="(min-width: 768px) 768px, 100vw" className="object-contain!" />
              <button
                type="button"
                onClick={() => go(-1)}
                className="absolute top-1/2 left-3 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow"
                aria-label="Previous image"
              >
                <ChevronLeft size={20} />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                className="absolute top-1/2 right-3 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow"
                aria-label="Next image"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </Dialog>,
          document.body,
        )}
    </div>
  );
}
