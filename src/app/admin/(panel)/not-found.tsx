import Link from "next/link";
import { Compass } from "lucide-react";

export default function AdminNotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
      <span className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-sand text-accent" aria-hidden>
        <Compass size={32} />
      </span>
      <h1 className="font-display text-4xl font-semibold">Page not found</h1>
      <p className="mt-2 text-muted">This admin page doesn&apos;t exist or may have moved.</p>
      <Link href="/admin" className="btn-primary btn-sm mt-7">
        Back to dashboard
      </Link>
    </div>
  );
}
