import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/utils";
import { PolicyPage } from "@/components/layout/PolicyPage";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How M&M COLLECTIONS collects, uses and protects your personal information.",
  alternates: { canonical: "/privacy-policy" },
};

export default function PrivacyPolicyPage() {
  return (
    <PolicyPage title="Privacy Policy" updated="1 November 2026" current="/privacy-policy">
      <p className="mt-6">
        {SITE.name} (&ldquo;we&rdquo;, &ldquo;us&rdquo;) respects your privacy. This policy explains what information we collect when
        you use our website and how we use it.
      </p>
      <h2>Information we collect</h2>
      <ul>
        <li>Contact details you provide: name, mobile number, email address.</li>
        <li>Delivery address details for fulfilling orders.</li>
        <li>Order history, wishlist and bag contents.</li>
        <li>Basic technical information such as browser type and pages visited.</li>
      </ul>
      <h2>How we use it</h2>
      <ul>
        <li>To process, deliver and support your orders.</li>
        <li>To send order updates and, if you subscribe, offers and new arrivals.</li>
        <li>To improve our website and product range.</li>
      </ul>
      <h2>Payments</h2>
      <p>
        Online payments are processed by Razorpay, a PCI-DSS compliant payment gateway. We never see or store your card details, UPI PIN
        or net banking login.
      </p>
      <h2>Sharing</h2>
      <p>We share only what&apos;s needed with delivery and payment partners to complete your order. We never sell your personal data.</p>
      <h2>Your choices</h2>
      <ul>
        <li>You can update your profile and addresses from My Account.</li>
        <li>You can unsubscribe from marketing emails at any time.</li>
        <li>
          To request deletion of your data, <Link href="/contact">contact us</Link>.
        </li>
      </ul>
      <h2>Cookies & local storage</h2>
      <p>We use your browser&apos;s local storage to remember your bag, wishlist and recently viewed items between visits.</p>
      <h2>Contact</h2>
      <p>
        Questions about privacy? Email <a href={`mailto:${SITE.email}`}>{SITE.email}</a>.
      </p>
    </PolicyPage>
  );
}
