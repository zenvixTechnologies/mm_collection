import type { Metadata } from "next";
import { PaymentsView } from "@/components/admin/sales/PaymentsView";

export const metadata: Metadata = { title: "Payments" };

export default function AdminPaymentsPage() {
  return <PaymentsView />;
}
