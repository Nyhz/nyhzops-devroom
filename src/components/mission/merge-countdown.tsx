'use client';

import { useState, useEffect } from 'react';

export function MergeCountdown({ retryAt }: { retryAt: number }) {
  const [remaining, setRemaining] = useState(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));

  useEffect(() => {
    const interval = setInterval(() => {
      const r = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      setRemaining(r);
      if (r <= 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [retryAt]);

  if (remaining <= 0) return <span className="text-xs text-dr-amber font-mono">Retrying...</span>;
  return <span className="text-xs text-dr-amber font-mono">Retry in {remaining}s</span>;
}
