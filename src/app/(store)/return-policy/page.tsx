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
    <PolicyPage title="Return & Refund Policy" updated="12 November 2026" current="/return-policy">
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
        <li>
          Prepaid orders (UPI / card / net banking): refunded in Indian Rupees (₹) to the original payment method through Razorpay
          within 5–7 working days of the quality check.
        </li>
        <li>The shipping charge is non-refundable unless the item was damaged or incorrect.</li>
      </ul>
      <h2>Damaged or incorrect items</h2>
      <p>
        If you receive a damaged or wrong item, contact us within 48 hours of delivery with photos (or an unboxing video — see below) and
        we&apos;ll replace it or refund you in full.
      </p>
      <h2>Unboxing video</h2>
      <p>
        We recommend recording a continuous unboxing video while opening your package. This helps us verify claims involving damaged,
        incorrect, or missing products.
      </p>
      <ul>
        <li>
          For damaged, incorrect, or missing items, we may ask you for an unboxing video or clear photographs to help us investigate the
          issue.
        </li>
        <li>
          If an unboxing video is unavailable, our team will review the complaint using the available evidence, order details, and
          shipping records.
        </li>
        <li>The absence of an unboxing video alone will not automatically disqualify an otherwise valid return or refund claim.</li>
      </ul>
    </PolicyPage>
  );
}
