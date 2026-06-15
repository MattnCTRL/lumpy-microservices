/**
 * Loading placeholders shown on a page's first fetch, so a cold load reads as
 * "loading" rather than a misleading first-run empty state.
 */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton-bar h-12 w-full" />
      ))}
    </div>
  );
}

/** A grid of card-shaped skeletons (for the dashboard / card pages). */
export function SkeletonCards({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="surface h-28 p-4">
          <div className="skeleton-bar mb-3 h-4 w-1/3" />
          <div className="skeleton-bar h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}
