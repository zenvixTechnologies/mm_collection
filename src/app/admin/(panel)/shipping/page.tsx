import type { Metadata } from "next";
import { ShippingView } from "@/components/admin/settings/ShippingView";

export const metadata: Metadata = { title: "Shipping" };

export default function AdminShippingPage() {
  return <ShippingView />;
}
