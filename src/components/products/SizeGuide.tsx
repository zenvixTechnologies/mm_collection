"use client";

import { useState } from "react";
import type { Product } from "@/types";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/ui/Dialog";

interface Chart {
  title: string;
  /** Measurement columns after the "Size" column, with how to measure each. */
  columns: { label: string; hint: string }[];
  rows: { size: string; values: number[] }[];
}

const CHARTS = {
  women: {
    title: "Women's size chart",
    columns: [
      { label: "Bust", hint: "Measure around the fullest part of your bust." },
      { label: "Waist", hint: "Measure around your natural waistline." },
      { label: "Hip", hint: "Measure around the fullest part of your hips." },
    ],
    rows: [
      { size: "XS", values: [32, 26, 35] },
      { size: "S", values: [34, 28, 37] },
      { size: "M", values: [36, 30, 39] },
      { size: "L", values: [38, 32, 41] },
      { size: "XL", values: [40, 34, 43] },
      { size: "XXL", values: [42, 36, 45] },
    ],
  },
  menTops: {
    title: "Men's tops & suits",
    columns: [
      { label: "Chest", hint: "Measure around the fullest part of your chest, under the arms." },
      { label: "Waist", hint: "Measure around your natural waistline." },
      { label: "Shoulder", hint: "Measure across the back, shoulder point to shoulder point." },
    ],
    rows: [
      { size: "S", values: [38, 32, 17] },
      { size: "M", values: [40, 34, 17.5] },
      { size: "L", values: [42, 36, 18] },
      { size: "XL", values: [44, 38, 18.5] },
      { size: "XXL", values: [46, 40, 19] },
    ],
  },
  menBottoms: {
    title: "Men's jeans & trousers",
    columns: [
      { label: "Waist", hint: "Measure where you normally wear your jeans." },
      { label: "Hip", hint: "Measure around the fullest part of your seat." },
      { label: "Inseam", hint: "Measure from the crotch seam to the ankle." },
    ],
    rows: [
      { size: "28", values: [28, 36, 31] },
      { size: "30", values: [30, 38, 31] },
      { size: "32", values: [32, 40, 32] },
      { size: "34", values: [34, 42, 32] },
      { size: "36", values: [36, 44, 32] },
    ],
  },
  kids: {
    title: "Kids' size chart",
    columns: [
      { label: "Height", hint: "Stand straight, without shoes, against a wall." },
      { label: "Chest", hint: "Measure around the fullest part of the chest." },
      { label: "Waist", hint: "Measure around the tummy, at the belly button." },
    ],
    rows: [
      { size: "0-6M", values: [26, 17, 17] },
      { size: "6-12M", values: [29, 18, 18] },
      { size: "1-2Y", values: [34, 19.5, 19] },
      { size: "3-4Y", values: [40, 21, 20] },
      { size: "5-6Y", values: [46, 23, 21] },
      { size: "7-8Y", values: [51, 25, 22] },
      { size: "9-10Y", values: [55, 27, 23] },
    ],
  },
} satisfies Record<string, Chart>;

/** Pick the chart that matches the product: women's, men's tops, men's waist sizes, or kids' ages. */
function chartFor(product: Product): Chart {
  if (product.audienceCategory === "kids") return CHARTS.kids;
  if (product.audienceCategory === "men") {
    return product.sizes.some((s) => /^\d+$/.test(s)) ? CHARTS.menBottoms : CHARTS.menTops;
  }
  return CHARTS.women;
}

export function SizeGuide({ open, onClose, product }: { open: boolean; onClose: () => void; product: Product }) {
  const [unit, setUnit] = useState<"in" | "cm">("in");
  const conv = (v: number) => (unit === "in" ? v : Math.round(v * 2.54));
  const chart = chartFor(product);

  return (
    <Dialog open={open} onClose={onClose} title="Size guide" variant="bottom-sheet" className="sm:max-w-xl">
      <div className="p-5">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-ink">{chart.title}</p>
            <p className="text-sm text-muted">Body measurements. If you&apos;re between sizes, choose the larger one.</p>
          </div>
          <div className="flex shrink-0 rounded-full bg-sand p-1 text-sm" role="group" aria-label="Units">
            {(["in", "cm"] as const).map((u) => (
              <button
                key={u}
                type="button"
                aria-pressed={unit === u}
                onClick={() => setUnit(u)}
                className={cn("rounded-full px-3 py-1 font-medium", unit === u ? "bg-white shadow-sm" : "text-muted")}
              >
                {u}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <caption className="sr-only">
              {chart.title} in {unit === "in" ? "inches" : "centimetres"}
            </caption>
            <thead className="bg-canvas">
              <tr>
                {["Size", ...chart.columns.map((c) => c.label)].map((h) => (
                  <th key={h} scope="col" className="px-4 py-3 text-left font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {chart.rows.map((r) => (
                <tr key={r.size} className={cn(!product.sizes.includes(r.size as never) && "opacity-50")}>
                  <th scope="row" className="px-4 py-3 text-left font-semibold">
                    {r.size}
                  </th>
                  {r.values.map((v, i) => (
                    <td key={chart.columns[i].label} className="px-4 py-3 text-muted">
                      {conv(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
          {chart.columns.map((c) => (
            <div key={c.label} className="rounded-xl bg-canvas p-3">
              <p className="font-semibold">{c.label}</p>
              <p className="mt-0.5 text-muted">{c.hint}</p>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
