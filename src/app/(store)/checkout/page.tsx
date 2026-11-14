import type { Metadata } from "next";
import { CheckoutView } from "@/components/checkout/CheckoutView";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false },
};

type Props = { searchParams: Promise<{ mode?: string }> };

export default async function CheckoutPage({ searchParams }: Props) {
  const { mode } = await searchParams;
  return <CheckoutView mode={mode === "buy-now" ? "buy-now" : "cart"} />;
}
