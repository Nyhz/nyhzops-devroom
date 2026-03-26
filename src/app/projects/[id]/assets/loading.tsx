export default function AssetsLoading() {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="h-5 w-24 bg-dr-elevated animate-pulse" />
        <div className="h-8 w-32 bg-dr-elevated animate-pulse" />
      </div>

      {/* Asset grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="bg-dr-surface border border-dr-border p-4 space-y-3"
          >
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-dr-elevated animate-pulse" />
              <div className="h-4 w-28 bg-dr-elevated animate-pulse" />
            </div>
            <div className="h-3 w-full bg-dr-elevated animate-pulse" />
            <div className="h-3 w-2/3 bg-dr-elevated animate-pulse" />
            <div className="flex items-center justify-between pt-2 border-t border-dr-border/50">
              <div className="h-3 w-24 bg-dr-elevated animate-pulse" />
              <div className="h-3 w-16 bg-dr-elevated animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
