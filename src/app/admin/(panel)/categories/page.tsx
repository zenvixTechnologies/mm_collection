import type { Metadata } from "next";
import { CategoriesView } from "@/components/admin/catalog/CategoriesView";

export const metadata: Metadata = { title: "Categories" };

export default function AdminCategoriesPage() {
  return <CategoriesView />;
}
