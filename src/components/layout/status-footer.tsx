export function StatusFooter() {
  return (
    <footer className="bg-dr-surface border-t border-dr-border px-4 py-2 md:px-6 md:py-2.5 flex items-center gap-3">
      <span className="text-dr-green text-sm">●</span>
      <span className="text-dr-dim text-[11px] sm:text-sm tracking-wide">
        LOCAL ACCESS ONLY<span className="hidden sm:inline"> — NOT SAFE TO EXPOSE TO A NETWORK</span>
      </span>
    </footer>
  );
}
