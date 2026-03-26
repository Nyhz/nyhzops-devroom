'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCommandOutput } from '@/hooks/use-command-output';
import { Terminal } from '@/components/ui/terminal';

interface ScaffoldOutputProps {
  battlefieldId: string;
}

export function ScaffoldOutput({ battlefieldId }: ScaffoldOutputProps) {
  const router = useRouter();
  const { logs, exitCode, isRunning, prependBufferedLogs } = useCommandOutput(battlefieldId);
  const [fetched, setFetched] = useState(false);

  // Fetch buffered logs on mount for late subscribers
  useEffect(() => {
    if (fetched) return;
    fetch(`/api/battlefields/${battlefieldId}/scaffold/logs`)
      .then(r => r.json())
      .then((data: { logs?: string; exitCode?: number | null; isComplete?: boolean }) => {
        if (data.logs) prependBufferedLogs(data.logs);
        setFetched(true);
      })
      .catch(() => setFetched(true));
  }, [battlefieldId, fetched, prependBufferedLogs]);

  // Refresh page when scaffold completes
  useEffect(() => {
    if (!isRunning && exitCode !== null) {
      const timer = setTimeout(() => router.refresh(), 2000);
      return () => clearTimeout(timer);
    }
  }, [isRunning, exitCode, router]);

  // Convert hook logs to Terminal format
  const terminalLogs = logs.map(l => ({
    timestamp: l.timestamp,
    type: 'log' as const,
    content: l.content,
  }));

  return (
    <div className="bg-dr-surface border border-dr-border">
      <div className="bg-dr-elevated px-3 py-2 border-b border-dr-border flex items-center gap-2">
        <span className="text-dr-amber text-xs font-tactical tracking-wider">
          SCAFFOLD
        </span>
        <span className="text-dr-dim text-xs">&mdash;</span>
        {isRunning ? (
          <span className="text-dr-amber text-xs animate-pulse">Running...</span>
        ) : exitCode === 0 ? (
          <span className="text-dr-green text-xs">Complete</span>
        ) : exitCode !== null ? (
          <span className="text-dr-red text-xs">Failed</span>
        ) : null}
      </div>
      <div className="max-h-64">
        <Terminal logs={terminalLogs} className="max-h-64" />
      </div>
      {!isRunning && exitCode !== null && (
        <div className="px-3 py-2 border-t border-dr-border text-xs font-tactical">
          {exitCode === 0 ? (
            <span className="text-dr-green">&#x2713; Exit 0</span>
          ) : (
            <span className="text-dr-red">&#x2717; Exit {exitCode}</span>
          )}
        </div>
      )}
    </div>
  );
}
