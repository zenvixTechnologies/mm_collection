import { notFound } from "next/navigation";

/** Unknown /mm-hub/* URLs show the admin 404 (inside the admin shell) instead of the storefront one. */
export default function AdminMissingPage() {
  notFound();
}
