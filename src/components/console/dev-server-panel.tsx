'use client';

import { useTransition } from 'react';
import { TacButton } from '@/components/ui/tac-button';
import { TacCard } from '@/components/ui/tac-card';
import { Terminal } from '@/components/ui/terminal';
import { useDevServer } from '@/hooks/use-dev-server';
import { startDevServer, stopDevServer, restartDevServer } from '@/actions/console';
import { formatDuration } from '@/lib/utils';

interface DevServerStatus {
  running: boolean;
  port: number | null;
  pid: number | null;
  uptime: number | null;
}

interface DevServerPanelProps {
  battlefieldId: string;
  initialStatus: DevServerStatus;
  devCommand: string;
}

export function DevServerPanel({ battlefieldId, initialStatus, devCommand }: DevServerPanelProps) {
  const [isPending, startTransition] = useTransition();

  const { logs, status, port, pid } = useDevServer(battlefieldId, {
    status: initialStatus.running ? 'running' : 'stopped',
    port: initialStatus.port,
    pid: initialStatus.pid,
  });

  const isRunning = status === 'running';

  const terminalLogs = logs.map(l => ({
    timestamp: l.timestamp,
    type: 'log' as const,
    content: l.content,
  }));

  function handleStart() {
    startTransition(async () => {
      await startDevServer(battlefieldId);
    });
  }

  function handleStop() {
    startTransition(async () => {
      await stopDevServer(battlefieldId);
    });
  }

  function handleRestart() {
    startTransition(async () => {
      await restartDevServer(battlefieldId);
    });
  }

  return (
    <TacCard status={isRunning ? 'green' : undefined}>
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span
              className={
                isRunning
                  ? 'text-dr-green text-xs font-tactical'
                  : 'text-dr-dim text-xs font-tactical'
              }
            >
              {isRunning ? '● RUNNING' : '● STOPPED'}
            </span>
            {pid !== null && isRunning && (
              <span className="text-dr-dim text-xs font-data">PID {pid}</span>
            )}
            {port !== null && isRunning && (
              <span className="text-dr-muted text-xs font-data">:{port}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isRunning ? (
              <TacButton
                size="sm"
                variant="success"
                onClick={handleStart}
                disabled={isPending}
              >
                START
              </TacButton>
            ) : (
              <>
                <TacButton
                  size="sm"
                  variant="danger"
                  onClick={handleStop}
                  disabled={isPending}
                >
                  STOP
                </TacButton>
                <TacButton
                  size="sm"
                  variant="primary"
                  onClick={handleRestart}
                  disabled={isPending}
                >
                  RESTART
                </TacButton>
              </>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="flex items-center gap-4 text-xs font-data text-dr-dim">
          <span>CMD: <span className="text-dr-muted">{devCommand}</span></span>
          {isRunning && initialStatus.uptime !== null && (
            <span>UPTIME: <span className="text-dr-muted">{formatDuration(initialStatus.uptime)}</span></span>
          )}
        </div>

        {/* Port link */}
        {isRunning && port !== null && (
          <a
            href={`http://localhost:${port}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-xs font-tactical text-dr-blue hover:underline"
          >
            Open http://localhost:{port} ↗
          </a>
        )}

        {/* Log stream */}
        <Terminal logs={terminalLogs} className="max-h-64" />
      </div>
    </TacCard>
  );
}
