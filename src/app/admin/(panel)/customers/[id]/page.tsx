import type { Metadata } from "next";
import { CustomerDetailView } from "@/components/admin/sales/CustomerDetailView";

type Props = { params: Promise<{ id: string }> };

export const metadata: Metadata = { title: "Customer" };

export default async function AdminCustomerPage({ params }: Props) {
  const { id } = await params;
  return <CustomerDetailView id={decodeURIComponent(id)} />;
}
