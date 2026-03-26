export default function CampaignDetailLoading() {
  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="h-3 w-48 bg-dr-elevated animate-pulse" />
        <div className="flex items-center gap-4">
          <div className="h-5 w-56 bg-dr-elevated animate-pulse" />
          <div className="h-5 w-24 bg-dr-elevated animate-pulse" />
        </div>
        <div className="h-3 w-96 bg-dr-elevated animate-pulse" />
      </div>

      {/* Phase timeline blocks */}
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="bg-dr-surface border border-dr-border border-l-2 border-l-dr-dim p-4 space-y-3"
        >
          {/* Phase header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-4 w-20 bg-dr-elevated animate-pulse" />
              <div className="h-4 w-40 bg-dr-elevated animate-pulse" />
            </div>
            <div className="h-4 w-20 bg-dr-elevated animate-pulse" />
          </div>
          <div className="h-3 w-72 bg-dr-elevated animate-pulse" />

          {/* Mission cards row */}
          <div className="flex gap-3 pt-2">
            {Array.from({ length: 2 + (i % 2) }).map((_, j) => (
              <div
                key={j}
                className="flex-1 bg-dr-bg border border-dr-border p-3 space-y-2"
              >
                <div className="h-3 w-3/4 bg-dr-elevated animate-pulse" />
                <div className="h-3 w-1/2 bg-dr-elevated animate-pulse" />
                <div className="h-3 w-16 bg-dr-elevated animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Controls */}
      <div className="flex gap-3">
        <div className="h-9 w-44 bg-dr-elevated animate-pulse" />
        <div className="h-9 w-28 bg-dr-elevated animate-pulse" />
        <div className="h-9 w-24 bg-dr-elevated animate-pulse" />
      </div>
    </div>
  );
}
