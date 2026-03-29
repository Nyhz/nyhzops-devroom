export default function BoardLoading() {
  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="h-5 w-40 bg-dr-elevated animate-pulse" />
        <div className="flex gap-2">
          <div className="h-8 w-28 bg-dr-elevated animate-pulse" />
          <div className="h-8 w-36 bg-dr-elevated animate-pulse" />
        </div>
      </div>
      {/* Columns */}
      <div className="flex gap-3 overflow-x-auto">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex-shrink-0 w-56 flex flex-col gap-2">
            <div className="h-4 w-24 bg-dr-elevated animate-pulse" />
            {Array.from({ length: 3 - Math.min(i, 2) }).map((_, j) => (
              <div key={j} className="h-16 bg-dr-elevated animate-pulse" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
