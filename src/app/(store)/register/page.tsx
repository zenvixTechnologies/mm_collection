import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthLayout } from "@/components/account/AuthLayout";
import { RegisterForm } from "@/components/account/AuthForms";

export const metadata: Metadata = {
  title: "Create an account",
  robots: { index: false },
};

export default function RegisterPage() {
  return (
    <AuthLayout title="Create your account" subtitle="Faster checkout, saved addresses and order history in one place.">
      <Suspense fallback={<div className="skeleton h-96 rounded-2xl" />}>
        <RegisterForm />
      </Suspense>
    </AuthLayout>
  );
}
