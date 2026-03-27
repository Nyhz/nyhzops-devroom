export default function GitLoading() {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <div className="h-4 w-32 bg-dr-elevated animate-pulse" />
        <div className="h-3 w-24 bg-dr-elevated animate-pulse mt-1" />
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-dr-border">
        {['STATUS', 'LOG', 'BRANCHES'].map((tab) => (
          <div key={tab} className="px-4 py-2">
            <div className="h-3 w-16 bg-dr-elevated animate-pulse" />
          </div>
        ))}
      </div>

      {/* Content block */}
      <div className="pt-4 space-y-3">
        {/* File status rows */}
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-3 w-6 bg-dr-elevated animate-pulse" />
            <div
              className="h-3 bg-dr-elevated animate-pulse"
              style={{ width: `${40 + ((i * 17) % 40)}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
