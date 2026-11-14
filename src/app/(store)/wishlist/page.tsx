import type { Metadata } from "next";
import { WishlistView } from "@/components/account/WishlistView";

export const metadata: Metadata = {
  title: "My Wishlist",
  robots: { index: false },
};

export default function WishlistPage() {
  return <WishlistView />;
}
