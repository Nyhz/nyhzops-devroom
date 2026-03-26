export default function ConsoleLoading() {
  return (
    <div className="space-y-6">
      {/* Dev Server Section */}
      <div className="space-y-2">
        <div className="h-4 w-28 bg-dr-elevated animate-pulse" />
        <div className="bg-dr-surface border border-dr-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-3 w-3 rounded-full bg-dr-elevated animate-pulse" />
              <div className="h-4 w-20 bg-dr-elevated animate-pulse" />
            </div>
            <div className="flex gap-2">
              <div className="h-8 w-20 bg-dr-elevated animate-pulse" />
              <div className="h-8 w-20 bg-dr-elevated animate-pulse" />
            </div>
          </div>
          <div className="h-48 bg-dr-bg border border-dr-border animate-pulse" />
        </div>
      </div>

      {/* Quick Commands Section */}
      <div className="space-y-2">
        <div className="h-4 w-36 bg-dr-elevated animate-pulse" />
        <div className="bg-dr-surface border border-dr-border p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 w-24 bg-dr-elevated animate-pulse" />
            ))}
          </div>
          <div className="flex gap-2">
            <div className="h-8 flex-1 bg-dr-elevated animate-pulse" />
            <div className="h-8 w-16 bg-dr-elevated animate-pulse" />
          </div>
        </div>
      </div>

      {/* Output Section */}
      <div className="space-y-2">
        <div className="h-4 w-20 bg-dr-elevated animate-pulse" />
        <div className="h-64 bg-dr-surface border border-dr-border animate-pulse" />
      </div>
    </div>
  );
}
