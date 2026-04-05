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
  const { logs, exitCode, isRunning, verifyStatus, verifyPhase } = useDepsOutput(battlefieldId);

  const terminalLogs = useMemo(
    () => logs.map(l => ({ content: l.content, timestamp: l.timestamp, type: 'comms' as const })),
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
      {verifyStatus === 'running' && (
        <div className="border border-amber-500/50 bg-amber-900/30 px-3 py-2 font-mono text-xs text-dr-amber">
          Verifying build and tests...
        </div>
      )}
      {verifyStatus === 'passed' && (
        <div className="border border-green-500/50 bg-green-900/30 px-3 py-2 font-mono text-xs text-dr-green">
          Verification PASSED — build and tests OK
        </div>
      )}
      {verifyStatus === 'failed' && (
        <div className="border border-red-500/50 bg-red-900/30 px-3 py-2 font-mono text-xs text-dr-red">
          {verifyPhase === 'update'
            ? 'Update FAILED'
            : 'Update succeeded but verification FAILED — build or tests broken'}
        </div>
      )}
    </div>
  );
}
