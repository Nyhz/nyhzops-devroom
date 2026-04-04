export default function TelemetryLoading() {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <div className="h-3 w-48 bg-dr-elevated animate-pulse mb-1" />
        <div className="h-6 w-36 bg-dr-elevated animate-pulse" />
      </div>

      {/* Active Processes skeleton */}
      <div className="bg-dr-surface border border-dr-border p-0">
        <div className="px-3 py-2 border-b border-dr-border flex items-center justify-between">
          <div className="h-3 w-40 bg-dr-elevated animate-pulse" />
          <div className="h-7 w-32 bg-dr-elevated animate-pulse" />
        </div>
        <div className="divide-y divide-dr-border/50">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2">
              <div className="h-3 w-40 bg-dr-elevated animate-pulse flex-1" />
              <div className="h-3 w-20 bg-dr-elevated animate-pulse" />
              <div className="h-5 w-24 bg-dr-elevated animate-pulse" />
              <div className="h-3 w-16 bg-dr-elevated animate-pulse" />
              <div className="h-7 w-16 bg-dr-elevated animate-pulse" />
            </div>
          ))}
        </div>
        <div className="px-3 py-3 border-t border-dr-border flex items-center gap-3">
          <div className="h-3 w-3 rounded-full bg-dr-elevated animate-pulse" />
          <div className="h-3 w-48 bg-dr-elevated animate-pulse flex-1" />
          <div className="h-7 w-20 bg-dr-elevated animate-pulse" />
          <div className="h-7 w-20 bg-dr-elevated animate-pulse" />
        </div>
      </div>

      {/* Resource Usage skeleton */}
      <div className="bg-dr-surface border border-dr-border p-0">
        <div className="px-3 py-2 border-b border-dr-border">
          <div className="h-3 w-36 bg-dr-elevated animate-pulse" />
        </div>
        <div className="flex gap-px bg-dr-border">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-dr-surface flex-1 px-4 py-3 space-y-1">
              <div className="h-3 w-16 bg-dr-elevated animate-pulse" />
              <div className="h-5 w-20 bg-dr-elevated animate-pulse" />
              <div className="h-3 w-12 bg-dr-elevated animate-pulse" />
            </div>
          ))}
        </div>
      </div>

      {/* Recent Exits skeleton */}
      <div className="bg-dr-surface border border-dr-border p-0">
        <div className="px-3 py-2 border-b border-dr-border flex items-center justify-between">
          <div className="h-3 w-32 bg-dr-elevated animate-pulse" />
          <div className="flex gap-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-7 w-20 bg-dr-elevated animate-pulse" />
            ))}
          </div>
        </div>
        <div className="divide-y divide-dr-border/50">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2">
              <div className="h-3 w-40 bg-dr-elevated animate-pulse flex-1" />
              <div className="h-5 w-20 bg-dr-elevated animate-pulse" />
              <div className="h-3 w-28 bg-dr-elevated animate-pulse" />
              <div className="h-3 w-16 bg-dr-elevated animate-pulse" />
              <div className="h-3 w-24 bg-dr-elevated animate-pulse" />
            </div>
          ))}
        </div>
      </div>

      {/* Service Health skeleton */}
      <div className="bg-dr-surface border border-dr-border p-0">
        <div className="px-3 py-2 border-b border-dr-border">
          <div className="h-3 w-44 bg-dr-elevated animate-pulse" />
        </div>
        <div className="grid grid-cols-2 gap-px bg-dr-border">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-dr-surface p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-dr-elevated animate-pulse" />
                <div className="h-3 w-24 bg-dr-elevated animate-pulse" />
              </div>
              <div className="h-3 w-32 bg-dr-elevated animate-pulse" />
              <div className="h-3 w-28 bg-dr-elevated animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
