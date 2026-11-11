import type { Metadata } from "next";
import Link from "next/link";
import { PolicyPage } from "@/components/layout/PolicyPage";

export const metadata: Metadata = {
  title: "Return & Refund Policy",
  description: "How returns, size exchanges and refunds work at M&M COLLECTIONS.",
  alternates: { canonical: "/return-policy" },
};

export default function ReturnPolicyPage() {
  return (
    <PolicyPage title="Return & Refund Policy" updated="1 November 2026" current="/return-policy">
      <p className="mt-6">We want you to love what you buy. If something isn&apos;t right, here&apos;s how we can help.</p>
      <h2>Return window</h2>
      <p>You can request a return or size exchange within 7 days of delivery.</p>
      <h2>Eligibility</h2>
      <ul>
        <li>Items must be unused, unwashed and in their original condition with all tags attached.</li>
        <li>Nightwear, innerwear and items marked “final sale” cannot be returned for hygiene reasons.</li>
        <li>Sarees must be returned with the unstitched blouse piece intact.</li>
      </ul>
      <h2>Size exchanges</h2>
      <p>Exchanges for a different size of the same product are free, subject to availability. If your size is out of stock we&apos;ll issue a refund instead.</p>
      <h2>How to request a return</h2>
      <ul>
        <li>
          Contact us through the <Link href="/contact">contact page</Link> or WhatsApp with your order ID.
        </li>
        <li>We&apos;ll arrange a reverse pickup within 2–3 working days.</li>
        <li>Once received, items go through a quick quality check.</li>
      </ul>
      <h2>Refunds</h2>
      <ul>
        <li>Prepaid orders (UPI / card): refunded to the original payment method within 5–7 working days of the quality check.</li>
        <li>Cash on Delivery orders: refunded to your bank account or UPI ID within 5–7 working days.</li>
        <li>The delivery fee (if any) is non-refundable unless the item was damaged or incorrect.</li>
      </ul>
      <h2>Damaged or incorrect items</h2>
      <p>If you receive a damaged or wrong item, contact us within 48 hours of delivery with photos and we&apos;ll replace it or refund you in full.</p>
    </PolicyPage>
  );
}
