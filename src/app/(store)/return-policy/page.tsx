import type { Metadata } from "next";
import { PolicyPage } from "@/components/layout/PolicyPage";
import { ReturnPolicyContent } from "@/components/layout/ReturnPolicyContent";

export const metadata: Metadata = {
  title: "Return & Refund Policy",
  description: "How returns, size exchanges and refunds work at M&M COLLECTIONS.",
  alternates: { canonical: "/return-policy" },
};

export default function ReturnPolicyPage() {
  return (
    <PolicyPage title="Return & Refund Policy" updated="17 November 2026" current="/return-policy">
      <ReturnPolicyContent anchor />
    </PolicyPage>
  );
}
