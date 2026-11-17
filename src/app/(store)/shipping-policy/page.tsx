import type { Metadata } from "next";
import Link from "next/link";
import { PolicyPage } from "@/components/layout/PolicyPage";
import { DELIVERY_DISCLAIMER, DELIVERY_ZONES, formatDeliveryZone } from "@/lib/policies";

export const metadata: Metadata = {
  title: "Shipping Policy",
  description: "Delivery timelines, charges and coverage for M&M COLLECTIONS orders across India.",
  alternates: { canonical: "/shipping-policy" },
};

export default function ShippingPolicyPage() {
  return (
    <PolicyPage title="Shipping Policy" updated="17 November 2026" current="/shipping-policy">
      <h2>Where we deliver</h2>
      <p>
        We currently deliver only to addresses within India, using a valid 6-digit Indian PIN code. We do not ship internationally or
        accept orders for delivery outside India.
      </p>
      <h2>Delivery charges</h2>
      <p>Shipping charges are applicable on orders. For details about the shipping charge for your order, please contact us.</p>
      <h2>Processing time</h2>
      <p>Orders are packed and dispatched from our Alappuzha store within 24–48 hours (excluding Sundays and public holidays).</p>
      <h2>Estimated delivery timelines</h2>
      <ul>
        {DELIVERY_ZONES.map((zone) => (
          <li key={zone.region}>
            <strong className="text-ink">{zone.region}:</strong> {formatDeliveryZone(zone)}
          </li>
        ))}
      </ul>
      <p>South India covers Tamil Nadu, Karnataka, Andhra Pradesh, Telangana and Puducherry.</p>
      <p>
        {DELIVERY_DISCLAIMER} You can check an estimate for your PIN code using the delivery checker on any product page.
      </p>
      <h2>Payment</h2>
      <p>
        All orders are prepaid online through Razorpay using UPI, Indian credit / debit cards or net banking, in Indian Rupees (₹)
        only. International cards and foreign-currency payments are not accepted. We do not offer Cash on Delivery.
      </p>
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
