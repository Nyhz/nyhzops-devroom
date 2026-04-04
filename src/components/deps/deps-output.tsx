'use client';

import { useMemo } from 'react';
import { useDepsOutput } from '@/hooks/use-deps-output';
import { Terminal } from '@/components/ui/terminal';
import { cn } from '@/lib/utils';

interface DepsOutputProps {
  battlefieldId: string;
  className?: string;
}

export function DepsOutput({ battlefieldId, className }: DepsOutputProps) {
  const { logs, exitCode, isRunning } = useDepsOutput(battlefieldId);

  const terminalLogs = useMemo(
    () => logs.map(l => ({ content: l.content, timestamp: l.timestamp, type: 'log' as const })),
    [logs],
  );

  const status = isRunning ? 'running' : exitCode === 0 ? 'succeeded' : exitCode !== null ? 'failed' : null;

  return (
    <div className={cn('space-y-2', className)}>
      {status && (
        <div className="flex items-center gap-2 font-mono text-xs">
          {status === 'running' && (
            <>
              <span className="inline-block h-2 w-2 rounded-full bg-dr-amber animate-pulse" />
              <span className="text-dr-amber">RUNNING</span>
            </>
          )}
          {status === 'succeeded' && (
            <>
              <span className="inline-block h-2 w-2 rounded-full bg-dr-green" />
              <span className="text-dr-green">COMPLETED</span>
            </>
          )}
          {status === 'failed' && (
            <>
              <span className="inline-block h-2 w-2 rounded-full bg-dr-red" />
              <span className="text-dr-red">FAILED (exit {exitCode})</span>
            </>
          )}
        </div>
      )}
      <Terminal logs={terminalLogs} />
    </div>
  );
}
