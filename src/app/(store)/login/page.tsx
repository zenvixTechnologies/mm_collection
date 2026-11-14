import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthLayout } from "@/components/account/AuthLayout";
import { LoginForm } from "@/components/account/AuthForms";

export const metadata: Metadata = {
  title: "Log in",
  robots: { index: false },
};

export default function LoginPage() {
  return (
    <AuthLayout title="Welcome back" subtitle="Log in to view your orders, wishlist and saved addresses.">
      <Suspense fallback={<div className="skeleton h-80 rounded-2xl" />}>
        <LoginForm />
      </Suspense>
    </AuthLayout>
  );
}
