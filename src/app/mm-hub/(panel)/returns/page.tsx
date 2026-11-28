import type { Metadata } from "next";
import { ReturnsView } from "@/components/admin/sales/ReturnsView";

export const metadata: Metadata = { title: "Returns & Cancellations" };

export default function AdminReturnsPage() {
  return <ReturnsView />;
}
