"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/ui/Dialog";

const ROWS = [
  { size: "XS", bust: 32, waist: 26, hip: 35 },
  { size: "S", bust: 34, waist: 28, hip: 37 },
  { size: "M", bust: 36, waist: 30, hip: 39 },
  { size: "L", bust: 38, waist: 32, hip: 41 },
  { size: "XL", bust: 40, waist: 34, hip: 43 },
  { size: "XXL", bust: 42, waist: 36, hip: 45 },
];

export function SizeGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [unit, setUnit] = useState<"in" | "cm">("in");
  const conv = (v: number) => (unit === "in" ? v : Math.round(v * 2.54));

  return (
    <Dialog open={open} onClose={onClose} title="Size guide" variant="bottom-sheet" className="sm:max-w-xl">
      <div className="p-5">
        <div className="mb-4 flex items-center justify-between gap-4">
          <p className="text-sm text-muted">Body measurements. If you&apos;re between sizes, choose the larger one.</p>
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
            <caption className="sr-only">Size chart in {unit === "in" ? "inches" : "centimetres"}</caption>
            <thead className="bg-canvas">
              <tr>
                {["Size", "Bust", "Waist", "Hip"].map((h) => (
                  <th key={h} scope="col" className="px-4 py-3 text-left font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ROWS.map((r) => (
                <tr key={r.size}>
                  <th scope="row" className="px-4 py-3 text-left font-semibold">
                    {r.size}
                  </th>
                  <td className="px-4 py-3 text-muted">{conv(r.bust)}</td>
                  <td className="px-4 py-3 text-muted">{conv(r.waist)}</td>
                  <td className="px-4 py-3 text-muted">{conv(r.hip)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
          {[
            ["Bust", "Measure around the fullest part of your bust."],
            ["Waist", "Measure around your natural waistline."],
            ["Hip", "Measure around the fullest part of your hips."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-xl bg-canvas p-3">
              <p className="font-semibold">{t}</p>
              <p className="mt-0.5 text-muted">{d}</p>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
