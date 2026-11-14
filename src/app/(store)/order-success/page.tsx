import type { Metadata } from "next";
import { OrderSuccessView } from "@/components/checkout/OrderSuccessView";

export const metadata: Metadata = {
  title: "Order Confirmed",
  robots: { index: false },
};

type Props = { searchParams: Promise<{ id?: string }> };

export default async function OrderSuccessPage({ searchParams }: Props) {
  const { id = "" } = await searchParams;
  return <OrderSuccessView id={id} />;
}
