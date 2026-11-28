import type { Metadata } from "next";
import { ReviewsView } from "@/components/admin/catalog/ReviewsView";

export const metadata: Metadata = { title: "Reviews" };

export default function AdminReviewsPage() {
  return <ReviewsView />;
}
