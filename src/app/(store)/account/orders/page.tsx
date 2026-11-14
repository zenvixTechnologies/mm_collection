import type { Metadata } from "next";
import { OrdersListView } from "@/components/account/OrdersViews";

export const metadata: Metadata = {
  title: "My Orders",
  robots: { index: false },
};

export default function OrdersPage() {
  return <OrdersListView />;
}
