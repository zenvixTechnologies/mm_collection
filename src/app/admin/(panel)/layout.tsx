import { AdminShell } from "@/components/admin/layout/AdminShell";

/** Every signed-in admin screen (everything except /admin/login). */
export default function AdminPanelLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AdminShell>{children}</AdminShell>;
}
