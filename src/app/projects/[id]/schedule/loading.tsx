export default function ScheduleLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="h-5 w-40 bg-dr-elevated animate-pulse" />
        <div className="h-8 w-32 bg-dr-elevated animate-pulse" />
      </div>

      {/* Task cards */}
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-dr-surface border border-dr-border p-4 flex items-center justify-between"
          >
            <div className="flex flex-col gap-2 flex-1">
              <div className="flex items-center gap-3">
                <div className="h-4 w-40 bg-dr-elevated animate-pulse" />
                <div className="h-4 w-16 bg-dr-elevated animate-pulse" />
              </div>
              <div className="flex items-center gap-4">
                <div className="h-3 w-24 bg-dr-elevated animate-pulse" />
                <div className="h-3 w-32 bg-dr-elevated animate-pulse" />
                <div className="h-3 w-20 bg-dr-elevated animate-pulse" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 bg-dr-elevated animate-pulse" />
              <div className="h-8 w-8 bg-dr-elevated animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
