'use client';

export const dynamic = 'force-dynamic';

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <h1>Critical Error</h1>
        <button onClick={() => reset()}>Retry</button>
      </body>
    </html>
  );
}
