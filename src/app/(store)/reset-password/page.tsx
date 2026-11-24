import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthLayout } from "@/components/account/AuthLayout";
import { ResetPasswordForm } from "@/components/account/ResetPasswordForm";

export const metadata: Metadata = {
  title: "Reset password",
  robots: { index: false, follow: false },
  // The token is in the URL — never send it to other sites as a referrer.
  referrer: "no-referrer",
};

export default function ResetPasswordPage() {
  return (
    <AuthLayout title="Choose a new password" subtitle="Pick a strong password you don't use anywhere else.">
      <Suspense fallback={<div className="skeleton h-72 rounded-2xl" />}>
        <ResetPasswordForm />
      </Suspense>
    </AuthLayout>
  );
}
