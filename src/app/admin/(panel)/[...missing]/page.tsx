import { notFound } from "next/navigation";

/** Unknown /admin/* URLs show the admin 404 (inside the admin shell) instead of the storefront one. */
export default function AdminMissingPage() {
  notFound();
}
