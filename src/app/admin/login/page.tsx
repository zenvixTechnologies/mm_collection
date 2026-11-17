import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminLoginView } from "@/components/admin/auth/AdminLoginView";

export const metadata: Metadata = { title: "Sign in" };

export default function AdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <AdminLoginView />
    </Suspense>
  );
}
