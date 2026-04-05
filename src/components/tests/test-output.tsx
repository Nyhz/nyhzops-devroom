'use client';

import { useMemo, useState } from 'react';
import { useTestOutput } from '@/hooks/use-test-output';
import { Terminal } from '@/components/ui/terminal';
import { cn } from '@/lib/utils';

interface TestOutputProps {
  battlefieldId: string;
  collapsed?: boolean;
  className?: string;
}

export function TestOutput({ battlefieldId, collapsed, className }: TestOutputProps) {
  const { logs, exitCode, isRunning, completedRunId } = useTestOutput(battlefieldId);
  const [manualExpand, setManualExpand] = useState(false);

  const terminalLogs = useMemo(
    () => logs.map(l => ({ content: l.content, timestamp: l.timestamp, type: 'comms' as const })),
    [logs],
  );

  const status = isRunning ? 'running' : exitCode === 0 ? 'succeeded' : exitCode !== null ? 'failed' : null;
  const shouldCollapse = !isRunning && (collapsed || completedRunId !== null) && !manualExpand;

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
          {!isRunning && logs.length > 0 && (
            <button
              onClick={() => setManualExpand(prev => !prev)}
              className="ml-auto text-dr-dim hover:text-dr-text transition-colors"
            >
              {shouldCollapse ? '▶ SHOW OUTPUT' : '▼ HIDE OUTPUT'}
            </button>
          )}
        </div>
      )}
      {!shouldCollapse && <Terminal logs={terminalLogs} />}
    </div>
  );
}
