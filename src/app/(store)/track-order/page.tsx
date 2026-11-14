import type { Metadata } from "next";
import { TrackOrderView } from "@/components/account/OrdersViews";

export const metadata: Metadata = {
  title: "Track Your Order",
  description: "Check the delivery status of your M&M COLLECTIONS order with your order ID.",
};

type Props = { searchParams: Promise<{ id?: string }> };

export default async function TrackOrderPage({ searchParams }: Props) {
  const { id = "" } = await searchParams;
  return <TrackOrderView key={id} initialId={id.toUpperCase()} />;
}
