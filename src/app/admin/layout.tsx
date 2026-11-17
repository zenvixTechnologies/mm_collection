import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin | M&M COLLECTIONS" },
  robots: { index: false, follow: false },
};

/** Admin panel root. Deliberately has no storefront header/footer — see app/(store)/layout.tsx. */
export default function AdminRootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="min-h-dvh bg-canvas">{children}</div>;
}
