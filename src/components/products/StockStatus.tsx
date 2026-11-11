import { cn } from "@/lib/utils";

export function StockStatus({ stock, className }: { stock: number; className?: string }) {
  const tone = stock <= 0 ? "bg-danger" : stock <= 5 ? "bg-warning" : "bg-success";
  const label = stock <= 0 ? "Out of stock" : stock <= 5 ? `Only ${stock} left — order soon` : "In stock, ready to ship";
  return (
    <p className={cn("flex items-center gap-2 text-sm", stock <= 0 ? "text-danger" : stock <= 5 ? "text-warning" : "text-success", className)}>
      <span className={cn("h-2 w-2 rounded-full", tone)} aria-hidden />
      {label}
    </p>
  );
}
