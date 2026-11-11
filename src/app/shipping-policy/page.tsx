import type { Metadata } from "next";
import Link from "next/link";
import { PolicyPage } from "@/components/layout/PolicyPage";

export const metadata: Metadata = {
  title: "Shipping Policy",
  description: "Delivery timelines, charges and coverage for M&M COLLECTIONS orders across India.",
  alternates: { canonical: "/shipping-policy" },
};

export default function ShippingPolicyPage() {
  return (
    <PolicyPage title="Shipping Policy" updated="1 November 2026" current="/shipping-policy">
      <h2>Delivery charges</h2>
      <ul>
        <li>Free standard delivery on all orders of ₹999 and above (after discounts).</li>
        <li>A flat delivery fee of ₹79 applies to orders below ₹999.</li>
        <li>The FREESHIP coupon waives the delivery fee on any order.</li>
      </ul>
      <h2>Processing time</h2>
      <p>Orders are packed and dispatched from our Kochi store within 24–48 hours (excluding Sundays and public holidays).</p>
      <h2>Delivery timelines</h2>
      <ul>
        <li>Within Kerala: 2–3 working days.</li>
        <li>South India (Tamil Nadu, Karnataka, Andhra Pradesh, Telangana): 3–5 working days.</li>
        <li>Rest of India: 4–7 working days.</li>
      </ul>
      <p>Timelines are estimates; remote areas or courier delays may add a few days. You can check an estimate using the PIN code checker on any product page.</p>
      <h2>Cash on Delivery</h2>
      <p>COD is available on most serviceable PIN codes. Please keep the exact amount ready; delivery partners may also accept UPI.</p>
      <h2>Order tracking</h2>
      <p>
        Once your order ships you&apos;ll receive an SMS and email with tracking details. You can also check status any time on the{" "}
        <Link href="/track-order">Track Order</Link> page.
      </p>
      <h2>Questions?</h2>
      <p>
        Reach us through our <Link href="/contact">contact page</Link>.
      </p>
    </PolicyPage>
  );
}
