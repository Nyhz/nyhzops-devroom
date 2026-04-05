'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSocket, useReconnectKey } from '@/hooks/use-socket';
import { TacCard } from '@/components/ui/tac-card';
import { Terminal } from '@/components/ui/terminal';

interface ScaffoldLog {
  content: string;
  timestamp: number;
}

interface ScaffoldOutputProps {
  battlefieldId: string;
}

export function ScaffoldOutput({ battlefieldId }: ScaffoldOutputProps) {
  const router = useRouter();
  const socket = useSocket();
  const reconnectKey = useReconnectKey();
  const [logs, setLogs] = useState<ScaffoldLog[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [isRunning, setIsRunning] = useState(true);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (!socket) return;

    const handleOutput = (data: { battlefieldId: string; content: string; timestamp: number }) => {
      if (data.battlefieldId === battlefieldId) {
        setLogs(prev => [...prev, { content: data.content, timestamp: data.timestamp }]);
      }
    };

    const handleExit = (data: { battlefieldId: string; exitCode: number }) => {
      if (data.battlefieldId === battlefieldId) {
        setExitCode(data.exitCode);
        setIsRunning(false);
      }
    };

    socket.on('console:output', handleOutput);
    socket.on('console:exit', handleExit);

    return () => {
      socket.off('console:output', handleOutput);
      socket.off('console:exit', handleExit);
    };
  }, [socket, battlefieldId, reconnectKey]);

  const prependBufferedLogs = useCallback((buffered: string) => {
    if (!buffered) return;
    const lines = buffered.split('\n').filter(Boolean);
    const bufferedLogs = lines.map((content, i) => ({
      content: content + '\n',
      timestamp: i,
    }));
    setLogs(prev => {
      if (prev.length === 0 || prev[0].timestamp > 100) {
        return [...bufferedLogs, ...prev];
      }
      return prev;
    });
  }, []);

  // Fetch buffered logs on mount for late subscribers
  useEffect(() => {
    if (fetched) return;
    fetch(`/api/battlefields/${battlefieldId}/scaffold/logs`)
      .then(r => r.json())
      .then((data: { logs?: string; exitCode?: number | null; isComplete?: boolean }) => {
        if (data.logs) prependBufferedLogs(data.logs);
        if (data.isComplete) {
          setExitCode(data.exitCode ?? null);
          setIsRunning(false);
        }
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

  // Convert logs to Terminal format
  const terminalLogs = logs.map(l => ({
    timestamp: l.timestamp,
    type: 'comms' as const,
    content: l.content,
  }));

  return (
    <TacCard className="p-0">
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
    </TacCard>
  );
}
