export default function RootLoading() {
  return (
    <div className="bg-dr-surface p-6 space-y-4">
      <div className="text-dr-dim font-tactical text-xs tracking-widest uppercase mb-6">
        LOADING...
      </div>
      <div className="h-4 w-3/4 bg-dr-elevated animate-pulse" />
      <div className="h-4 w-1/2 bg-dr-elevated animate-pulse" />
      <div className="h-4 w-5/6 bg-dr-elevated animate-pulse" />
      <div className="h-4 w-2/3 bg-dr-elevated animate-pulse" />
      <div className="h-4 w-1/3 bg-dr-elevated animate-pulse" />
    </div>
  );
}
