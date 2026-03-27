export default function CampaignsLoading() {
  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="h-5 w-32 bg-dr-elevated animate-pulse" />
        <div className="h-8 w-36 bg-dr-elevated animate-pulse" />
      </div>

      {/* Campaign grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="bg-dr-surface border border-dr-border p-4 flex flex-col gap-3"
          >
            <div className="h-4 w-40 bg-dr-elevated animate-pulse" />
            <div className="h-3 w-full bg-dr-elevated animate-pulse" />
            <div className="h-3 w-3/4 bg-dr-elevated animate-pulse" />
            <div className="flex items-center justify-between mt-auto pt-2 border-t border-dr-border/50">
              <div className="h-4 w-20 bg-dr-elevated animate-pulse" />
              <div className="h-3 w-24 bg-dr-elevated animate-pulse" />
            </div>
          </div>
        ))}
      </div>

      {/* Templates section */}
      <div className="border-t border-dr-border/50 pt-6">
        <div className="h-4 w-24 bg-dr-elevated animate-pulse mb-4" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="bg-dr-surface border border-dr-border p-4 flex items-center justify-between"
            >
              <div className="flex flex-col gap-1">
                <div className="h-4 w-48 bg-dr-elevated animate-pulse" />
                <div className="h-3 w-32 bg-dr-elevated animate-pulse" />
              </div>
              <div className="flex gap-2">
                <div className="h-8 w-16 bg-dr-elevated animate-pulse" />
                <div className="h-8 w-28 bg-dr-elevated animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
