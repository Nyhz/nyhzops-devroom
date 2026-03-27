export default function ConfigLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="h-3 w-40 bg-dr-elevated animate-pulse mb-1" />
        <div className="h-5 w-32 bg-dr-elevated animate-pulse" />
      </div>

      {/* Form fields */}
      <div className="bg-dr-surface border border-dr-border p-6 space-y-5">
        {/* Name field */}
        <div className="space-y-1">
          <div className="h-3 w-16 bg-dr-elevated animate-pulse" />
          <div className="h-9 w-full bg-dr-bg border border-dr-border animate-pulse" />
        </div>

        {/* Codename field */}
        <div className="space-y-1">
          <div className="h-3 w-24 bg-dr-elevated animate-pulse" />
          <div className="h-9 w-full bg-dr-bg border border-dr-border animate-pulse" />
        </div>

        {/* Description field */}
        <div className="space-y-1">
          <div className="h-3 w-28 bg-dr-elevated animate-pulse" />
          <div className="h-20 w-full bg-dr-bg border border-dr-border animate-pulse" />
        </div>

        {/* Two-column row */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <div className="h-3 w-28 bg-dr-elevated animate-pulse" />
            <div className="h-9 w-full bg-dr-bg border border-dr-border animate-pulse" />
          </div>
          <div className="space-y-1">
            <div className="h-3 w-36 bg-dr-elevated animate-pulse" />
            <div className="h-9 w-full bg-dr-bg border border-dr-border animate-pulse" />
          </div>
        </div>

        {/* Toggle */}
        <div className="flex items-center gap-3">
          <div className="h-5 w-9 bg-dr-elevated animate-pulse rounded-full" />
          <div className="h-3 w-40 bg-dr-elevated animate-pulse" />
        </div>

        {/* Read-only paths */}
        <div className="space-y-1">
          <div className="h-3 w-20 bg-dr-elevated animate-pulse" />
          <div className="h-9 w-full bg-dr-bg border border-dr-border animate-pulse opacity-50" />
        </div>

        {/* Submit button */}
        <div className="flex justify-end pt-2">
          <div className="h-9 w-28 bg-dr-elevated animate-pulse" />
        </div>
      </div>
    </div>
  );
}
