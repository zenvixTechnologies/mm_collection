"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="container-page flex min-h-[50vh] flex-col items-center justify-center py-20 text-center">
      <h1 className="font-display text-4xl font-semibold">Something went wrong</h1>
      <p className="mt-3 max-w-md text-muted">Sorry — we hit an unexpected problem loading this page. Please try again.</p>
      <div className="mt-8 flex gap-3">
        <button type="button" onClick={reset} className="btn-primary px-8">
          Try again
        </button>
        <Link href="/" className="btn-outline px-8">
          Go home
        </Link>
      </div>
    </div>
  );
}
