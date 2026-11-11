"use client";

import Link from "next/link";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { IMG, wide } from "@/data/images";
import { toast } from "@/store/ui-store";
import { ProductImage } from "@/components/ui/ProductImage";
import { Reveal } from "@/components/ui/Reveal";

export function PromoBanner() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText("FESTIVE20");
      setCopied(true);
      toast.success("Code FESTIVE20 copied — apply it in your bag");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.info("Use code FESTIVE20 at checkout");
    }
  };

  return (
    <Reveal>
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-accent-dark via-accent to-[#7a0b11] text-white">
        <div className="absolute inset-y-0 right-0 hidden w-1/2 md:block">
          <ProductImage src={wide(IMG.printRack, "4:3")} alt="" fill sizes="50vw" className="opacity-90" />
          <div className="absolute inset-0 bg-gradient-to-r from-accent-dark via-accent-dark/40 to-transparent" />
        </div>
        <div className="relative px-6 py-12 sm:px-12 md:w-3/5 md:py-16">
          <p className="text-xs font-semibold tracking-[0.2em] text-gold-light uppercase">◆ Festive Season Sale</p>
          <h2 className="mt-3 font-display text-4xl leading-tight font-semibold text-white sm:text-5xl">
            Extra 20% off on orders above ₹2,999
          </h2>
          <p className="mt-3 max-w-md text-white/85">
            Stock up on sarees, kurtis and party wear. Valid on all styles, including sale — limited period only.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href="/shop" className="btn-light min-h-12 px-7">
              Shop the Sale
            </Link>
            <button
              type="button"
              onClick={copy}
              className="flex min-h-12 items-center gap-2 rounded-full border border-dashed border-gold-light px-5 text-gold-light text-sm font-semibold tracking-wider transition-colors hover:bg-white/10"
              aria-label="Copy coupon code FESTIVE20"
            >
              {copied ? <Check size={16} /> : <Copy size={16} />} FESTIVE20
            </button>
          </div>
        </div>
      </div>
    </Reveal>
  );
}
