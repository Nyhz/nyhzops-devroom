'use client';

import { TacButton } from '@/components/ui/tac-button';

const ERROR_QUOTES = [
  'No plan survives first contact with the enemy. — Helmuth von Moltke',
  'In the midst of chaos, there is also opportunity. — Sun Tzu',
  'Brave men rejoice in adversity, just as brave soldiers triumph in war. — Seneca',
  'The only easy day was yesterday. — Navy SEALs',
  'A good plan violently executed now is better than a perfect plan executed next week. — Patton',
];

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const quote = ERROR_QUOTES[Math.floor(Math.random() * ERROR_QUOTES.length)];

  return (
    <div className="flex flex-col items-center justify-center h-full p-8">
      {/* Red alert banner */}
      <div className="w-full max-w-xl bg-dr-red/10 border border-dr-red p-4 mb-6">
        <div className="text-dr-red font-tactical text-sm tracking-widest uppercase text-center">
          ALERT — SYSTEM ERROR DETECTED
        </div>
      </div>

      {/* Military quote */}
      <div className="text-dr-amber font-data text-xs text-center italic mb-8 max-w-md">
        &ldquo;{quote}&rdquo;
      </div>

      {/* Error message */}
      <div className="text-dr-text font-tactical text-sm text-center mb-6">
        Commander, an unexpected error has compromised this operation.
      </div>

      {/* Retry button */}
      <TacButton variant="danger" onClick={() => reset()}>
        RETRY
      </TacButton>

      {/* Collapsible error details */}
      <details className="mt-6 w-full max-w-xl">
        <summary className="text-dr-dim font-tactical text-xs tracking-wider cursor-pointer hover:text-dr-muted">
          ERROR DETAILS
        </summary>
        <pre className="mt-2 bg-dr-bg border border-dr-border p-3 text-dr-dim font-mono text-xs overflow-auto max-h-48">
          {error.message}
          {error.digest && `\n\nDigest: ${error.digest}`}
          {error.stack && `\n\n${error.stack}`}
        </pre>
      </details>
    </div>
  );
}
