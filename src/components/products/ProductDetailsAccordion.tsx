"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Minus, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Product } from "@/types";
import { getCategory } from "@/data/categories";

export function ProductDetailsAccordion({ product }: { product: Product }) {
  const items: { id: string; title: string; content: ReactNode }[] = [
    {
      id: "description",
      title: "Product description",
      content: <p>{product.description}</p>,
    },
    {
      id: "info",
      title: "Product information",
      content: (
        <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2">
          <dt className="font-medium text-ink">Category</dt>
          <dd>{getCategory(product.categoryId)?.name}</dd>
          <dt className="font-medium text-ink">Available sizes</dt>
          <dd>{product.sizes.join(", ")}</dd>
          <dt className="font-medium text-ink">Colours</dt>
          <dd>{product.colors.map((c) => c.name).join(", ")}</dd>
          <dt className="font-medium text-ink">SKU</dt>
          <dd>{product.sku}</dd>
        </dl>
      ),
    },
    {
      id: "fabric",
      title: "Fabric & care",
      content: (
        <>
          <p>
            <strong className="text-ink">Fabric:</strong> {product.fabric}
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5">
            {product.care.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </>
      ),
    },
    {
      id: "shipping",
      title: "Shipping information",
      content: (
        <ul className="list-disc space-y-1 pl-5">
          <li>Shipping charges applicable.</li>
          <li>Orders are dispatched within 24–48 hours from our Alappuzha store.</li>
          <li>Delivery in 2–3 days within Kerala and 4–7 days across India.</li>
          <li>
            Read our full{" "}
            <Link href="/shipping-policy" className="text-accent underline">
              shipping policy
            </Link>
            .
          </li>
        </ul>
      ),
    },
    {
      id: "returns",
      title: "Returns & exchanges",
      content: (
        <ul className="list-disc space-y-1 pl-5">
          <li>Easy returns or size exchanges within 7 days of delivery.</li>
          <li>Items must be unworn, unwashed and have original tags attached.</li>
          <li>Innerwear, nightwear and sale items marked “final sale” can&apos;t be returned for hygiene reasons.</li>
          <li>
            See the{" "}
            <Link href="/return-policy" className="text-accent underline">
              return &amp; refund policy
            </Link>
            .
          </li>
        </ul>
      ),
    },
  ];

  const [open, setOpen] = useState<string | null>("description");

  return (
    <div className="divide-y divide-line border-y border-line">
      {items.map((item) => {
        const isOpen = open === item.id;
        return (
          <div key={item.id}>
            <h3>
              <button
                type="button"
                className="flex w-full items-center justify-between py-4 text-left text-[15px] font-semibold"
                aria-expanded={isOpen}
                aria-controls={`acc-${item.id}`}
                onClick={() => setOpen(isOpen ? null : item.id)}
              >
                {item.title}
                {isOpen ? <Minus size={17} /> : <Plus size={17} />}
              </button>
            </h3>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  id={`acc-${item.id}`}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22 }}
                  className="overflow-hidden"
                >
                  <div className="pb-5 text-[14.5px] leading-7 text-muted">{item.content}</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
