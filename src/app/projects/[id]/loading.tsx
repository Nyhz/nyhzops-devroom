export default function BattlefieldLoading() {
  return (
    <div className="p-6 space-y-6">
      {/* Header skeleton */}
      <div>
        <div className="h-3 w-48 bg-dr-elevated animate-pulse mb-2" />
        <div className="h-6 w-72 bg-dr-elevated animate-pulse mb-1" />
        <div className="h-3 w-96 bg-dr-elevated animate-pulse" />
      </div>

      {/* Deploy Mission card skeleton */}
      <div className="bg-dr-surface border border-dr-border p-4 space-y-3">
        <div className="h-3 w-32 bg-dr-elevated animate-pulse" />
        <div className="h-20 w-full bg-dr-elevated animate-pulse" />
        <div className="flex gap-3">
          <div className="h-8 w-36 bg-dr-elevated animate-pulse" />
          <div className="flex-1" />
          <div className="h-8 w-16 bg-dr-elevated animate-pulse" />
          <div className="h-8 w-28 bg-dr-elevated animate-pulse" />
        </div>
      </div>

      {/* Stats bar skeleton */}
      <div className="flex gap-px">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex-1 bg-dr-surface border border-dr-border p-3 flex flex-col items-center gap-1"
          >
            <div className="h-5 w-8 bg-dr-elevated animate-pulse" />
            <div className="h-2 w-16 bg-dr-elevated animate-pulse" />
          </div>
        ))}
      </div>

      {/* Missions skeleton */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="h-3 w-20 bg-dr-elevated animate-pulse" />
          <div className="h-8 w-64 bg-dr-elevated animate-pulse" />
        </div>
        <div className="bg-dr-surface border border-dr-border p-4 space-y-2">
          <div className="h-3 w-full bg-dr-elevated animate-pulse" />
          <div className="h-3 w-3/4 bg-dr-elevated animate-pulse" />
          <div className="h-3 w-1/2 bg-dr-elevated animate-pulse" />
        </div>
      </div>
    </div>
  );
}
