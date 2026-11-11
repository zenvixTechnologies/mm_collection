import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/utils";
import { PolicyPage } from "@/components/layout/PolicyPage";

export const metadata: Metadata = {
  title: "Terms & Conditions",
  description: "Terms and conditions for shopping at M&M COLLECTIONS.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <PolicyPage title="Terms & Conditions" updated="1 November 2026" current="/terms">
      <p className="mt-6">By using the {SITE.name} website and placing an order, you agree to the following terms.</p>
      <h2>Products & pricing</h2>
      <ul>
        <li>All prices are in Indian Rupees (₹) and include applicable taxes.</li>
        <li>Colours may vary slightly from photos due to screen settings and lighting.</li>
        <li>We may update prices and availability without notice; the price at checkout applies.</li>
      </ul>
      <h2>Orders</h2>
      <ul>
        <li>An order is confirmed once you receive an order ID.</li>
        <li>We may cancel an order if an item is unavailable or a pricing error occurs; any payment will be refunded in full.</li>
      </ul>
      <h2>Coupons</h2>
      <ul>
        <li>Only one coupon can be applied per order.</li>
        <li>Coupons have minimum order values and cannot be exchanged for cash.</li>
      </ul>
      <h2>Accounts</h2>
      <p>You are responsible for keeping your login details secure. Guest checkout is always available.</p>
      <h2>Returns</h2>
      <p>
        Returns and refunds are governed by our <Link href="/return-policy">Return &amp; Refund Policy</Link>.
      </p>
      <h2>Governing law</h2>
      <p>These terms are governed by the laws of India, with courts in Kochi, Kerala having jurisdiction.</p>
    </PolicyPage>
  );
}
