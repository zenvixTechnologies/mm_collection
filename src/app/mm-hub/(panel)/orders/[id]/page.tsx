import type { Metadata } from "next";
import { OrderDetailView } from "@/components/admin/sales/OrderDetailView";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: `Order ${decodeURIComponent(id)}` };
}

export default async function AdminOrderPage({ params }: Props) {
  const { id } = await params;
  return <OrderDetailView id={decodeURIComponent(id)} />;
}
