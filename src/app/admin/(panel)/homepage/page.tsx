import type { Metadata } from "next";
import { HomepageView } from "@/components/admin/marketing/HomepageView";

export const metadata: Metadata = { title: "Homepage" };

export default function AdminHomepagePage() {
  return <HomepageView />;
}
