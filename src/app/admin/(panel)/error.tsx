"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
      <h1 className="font-display text-4xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-muted">This screen hit an unexpected problem. Your demo changes in other screens are unaffected.</p>
      <div className="mt-7 flex gap-2">
        <button type="button" onClick={reset} className="btn-primary btn-sm">
          Try again
        </button>
        <Link href="/admin" className="btn-outline btn-sm">
          Dashboard
        </Link>
      </div>
    </div>
  );
}
