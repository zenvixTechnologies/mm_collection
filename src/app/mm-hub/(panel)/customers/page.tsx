import type { Metadata } from "next";
import { CustomersView } from "@/components/admin/sales/CustomersView";

export const metadata: Metadata = { title: "Customers" };

export default function AdminCustomersPage() {
  return <CustomersView />;
}
