'use client';

import { useState } from 'react';
import { Terminal } from '@/components/ui/terminal';
import { TacCard } from '@/components/ui/tac-card';
import { useCommandOutput } from '@/hooks/use-command-output';
import { formatRelativeTime } from '@/lib/utils';
import type { CommandLog } from '@/types';

interface CommandOutputProps {
  battlefieldId: string;
  commandHistory: CommandLog[];
}

export function CommandOutput({ battlefieldId, commandHistory }: CommandOutputProps) {
  const { logs, exitCode, isRunning } = useCommandOutput(battlefieldId);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const terminalLogs = logs.map(l => ({
    timestamp: l.timestamp,
    type: 'log' as const,
    content: l.content,
  }));

  const hasLiveOutput = logs.length > 0 || isRunning;

  return (
    <div className="space-y-3">
      {/* Live output */}
      <TacCard status={isRunning ? 'amber' : exitCode !== null ? (exitCode === 0 ? 'green' : 'red') : undefined}>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-dr-dim text-xs font-tactical tracking-wider">
              {isRunning ? '● LIVE OUTPUT' : 'OUTPUT'}
            </span>
            {exitCode !== null && (
              <span
                className={`text-xs font-data ${exitCode === 0 ? 'text-dr-green' : 'text-dr-red'}`}
              >
                {exitCode === 0 ? '✓' : '✗'} Exit {exitCode}
              </span>
            )}
          </div>
          {hasLiveOutput ? (
            <Terminal logs={terminalLogs} className="max-h-80" />
          ) : (
            <div className="text-dr-dim text-xs font-data py-4 text-center">
              No active output. Run a command to see results.
            </div>
          )}
        </div>
      </TacCard>

      {/* Command history */}
      {commandHistory.length > 0 && (
        <div className="space-y-1">
          <div className="text-dr-dim text-xs font-tactical tracking-wider mb-2">
            HISTORY
          </div>
          {commandHistory.map(entry => (
            <div key={entry.id} className="border border-dr-border bg-dr-surface">
              <button
                className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-dr-elevated transition-colors"
                onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`text-xs font-data shrink-0 ${
                      entry.exitCode === 0 ? 'text-dr-green' : entry.exitCode !== null ? 'text-dr-red' : 'text-dr-dim'
                    }`}
                  >
                    {entry.exitCode === 0 ? '✓' : entry.exitCode !== null ? '✗' : '·'}
                  </span>
                  <span className="text-dr-text text-xs font-data truncate">{entry.command}</span>
                </div>
                <span className="text-dr-dim text-xs font-data shrink-0">
                  {formatRelativeTime(entry.createdAt)}
                </span>
              </button>
              {expandedId === entry.id && entry.output && (
                <div className="border-t border-dr-border px-3 py-2 bg-dr-bg">
                  <pre className="text-dr-muted text-xs font-data whitespace-pre-wrap break-all max-h-40 overflow-auto">
                    {entry.output}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
