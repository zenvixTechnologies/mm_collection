export function ProductCardSkeleton() {
  return (
    <div aria-hidden>
      <div className="skeleton aspect-[4/5] w-full rounded-[var(--radius-card)]" />
      <div className="skeleton mt-3 h-4 w-3/4" />
      <div className="skeleton mt-2 h-4 w-1/3" />
    </div>
  );
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 md:grid-cols-3 lg:grid-cols-4" role="status" aria-label="Loading products">
      {Array.from({ length: count }, (_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function LineSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-4">
          <div className="skeleton h-28 w-22 shrink-0" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="skeleton h-4 w-2/3" />
            <div className="skeleton h-4 w-1/3" />
            <div className="skeleton h-9 w-28 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
