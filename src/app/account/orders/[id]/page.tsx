import type { Metadata } from "next";
import { OrderDetailView } from "@/components/account/OrdersViews";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: `Order #${id.toUpperCase()}`, robots: { index: false } };
}

export default async function OrderDetailPage({ params }: Props) {
  const { id } = await params;
  return <OrderDetailView id={id.toUpperCase()} />;
}
