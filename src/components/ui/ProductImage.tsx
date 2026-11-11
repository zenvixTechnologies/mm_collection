"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";
import { FALLBACK_IMAGE } from "@/data/images";
import { cn } from "@/lib/utils";

/** next/image wrapper that swaps to a branded placeholder if the photo fails to load. */
export function ProductImage({ src, alt, className, ...props }: ImageProps) {
  const [failed, setFailed] = useState(false);
  return (
    <Image
      {...props}
      src={failed ? FALLBACK_IMAGE : src}
      alt={alt}
      className={cn("object-cover", className)}
      onError={() => setFailed(true)}
      unoptimized={failed}
    />
  );
}
