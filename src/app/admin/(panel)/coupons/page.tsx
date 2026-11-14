import type { Metadata } from "next";
import { CouponsView } from "@/components/admin/marketing/CouponsView";

export const metadata: Metadata = { title: "Coupons & Offers" };

export default function AdminCouponsPage() {
  return <CouponsView />;
}
