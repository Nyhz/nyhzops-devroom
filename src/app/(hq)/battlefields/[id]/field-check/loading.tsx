export default function FieldCheckLoading() {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <div className="h-3 w-48 bg-dr-elevated animate-pulse mb-1" />
        <div className="h-6 w-40 bg-dr-elevated animate-pulse" />
      </div>

      {/* Worktree Board skeleton */}
      <div className="bg-dr-surface border border-dr-border p-0">
        <div className="px-3 py-2 border-b border-dr-border flex items-center justify-between">
          <div className="h-3 w-36 bg-dr-elevated animate-pulse" />
          <div className="h-7 w-32 bg-dr-elevated animate-pulse" />
        </div>
        <div className="divide-y divide-dr-border/50">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2">
              <div className="h-3 w-3 rounded-full bg-dr-elevated animate-pulse shrink-0" />
              <div className="h-3 w-48 bg-dr-elevated animate-pulse flex-1" />
              <div className="h-3 w-24 bg-dr-elevated animate-pulse" />
              <div className="h-3 w-12 bg-dr-elevated animate-pulse" />
              <div className="h-7 w-20 bg-dr-elevated animate-pulse" />
            </div>
          ))}
        </div>
      </div>

      {/* Branch Hygiene skeleton */}
      <div className="bg-dr-surface border border-dr-border p-0">
        <div className="px-3 py-2 border-b border-dr-border flex items-center justify-between">
          <div className="h-3 w-32 bg-dr-elevated animate-pulse" />
          <div className="h-7 w-36 bg-dr-elevated animate-pulse" />
        </div>
        <div className="grid grid-cols-4 gap-px border-b border-dr-border bg-dr-border">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-dr-surface px-4 py-3 space-y-1">
              <div className="h-3 w-16 bg-dr-elevated animate-pulse" />
              <div className="h-6 w-10 bg-dr-elevated animate-pulse" />
            </div>
          ))}
        </div>
        <div className="divide-y divide-dr-border/50">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2">
              <div className="h-3 w-40 bg-dr-elevated animate-pulse flex-1" />
              <div className="h-3 w-32 bg-dr-elevated animate-pulse" />
              <div className="h-3 w-12 bg-dr-elevated animate-pulse" />
              <div className="h-7 w-16 bg-dr-elevated animate-pulse" />
            </div>
          ))}
        </div>
      </div>

      {/* Quartermaster Log skeleton */}
      <div className="bg-dr-surface border border-dr-border p-0">
        <div className="px-3 py-2 border-b border-dr-border">
          <div className="h-3 w-44 bg-dr-elevated animate-pulse" />
        </div>
        <div className="divide-y divide-dr-border/50">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2">
              <div className="h-3 w-32 bg-dr-elevated animate-pulse" />
              <div className="h-3 w-48 bg-dr-elevated animate-pulse flex-1" />
              <div className="h-5 w-28 bg-dr-elevated animate-pulse" />
              <div className="h-3 w-16 bg-dr-elevated animate-pulse" />
            </div>
          ))}
        </div>
      </div>

      {/* Repo Vitals skeleton */}
      <div className="bg-dr-surface border border-dr-border p-0">
        <div className="px-3 py-2 border-b border-dr-border">
          <div className="h-3 w-28 bg-dr-elevated animate-pulse" />
        </div>
        <div className="flex gap-px bg-dr-border">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-dr-surface flex-1 px-4 py-3 space-y-1">
              <div className="h-3 w-20 bg-dr-elevated animate-pulse" />
              <div className="h-5 w-16 bg-dr-elevated animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
