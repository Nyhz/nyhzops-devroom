'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSocket, useReconnectKey } from '@/hooks/use-socket';

const MAX_LOGS = 500;

interface TestLog {
  content: string;
  timestamp: number;
}

interface TestCompleteSummary {
  passed: number;
  failed: number;
  skipped: number;
  totalTests: number;
  durationMs: number;
}

export function useTestOutput(battlefieldId: string) {
  const socket = useSocket();
  const reconnectKey = useReconnectKey();
  const [logs, setLogs] = useState<TestLog[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [completedRunId, setCompletedRunId] = useState<string | null>(null);
  const [completedSummary, setCompletedSummary] = useState<TestCompleteSummary | null>(null);

  useEffect(() => {
    if (!socket) return;

    socket.emit('tests:subscribe', battlefieldId);

    const handleOutput = (data: { battlefieldId: string; content: string; timestamp: number }) => {
      if (data.battlefieldId === battlefieldId) {
        setLogs(prev => {
          const next = [...prev, { content: data.content, timestamp: data.timestamp }];
          if (next.length > MAX_LOGS) {
            return next.slice(next.length - MAX_LOGS);
          }
          return next;
        });
      }
    };

    const handleExit = (data: { battlefieldId: string; exitCode: number; durationMs: number }) => {
      if (data.battlefieldId === battlefieldId) {
        setExitCode(data.exitCode);
        setIsRunning(false);
      }
    };

    const handleComplete = (data: { battlefieldId: string; testRunId: string; summary: TestCompleteSummary }) => {
      if (data.battlefieldId === battlefieldId) {
        setCompletedRunId(data.testRunId);
        setCompletedSummary(data.summary);
      }
    };

    socket.on('console:output', handleOutput);
    socket.on('console:exit', handleExit);
    socket.on('tests:complete', handleComplete);

    return () => {
      socket.off('console:output', handleOutput);
      socket.off('console:exit', handleExit);
      socket.off('tests:complete', handleComplete);
      socket.emit('tests:unsubscribe', battlefieldId);
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

  const reset = useCallback(() => {
    setLogs([]);
    setExitCode(null);
    setIsRunning(true);
    setCompletedRunId(null);
    setCompletedSummary(null);
  }, []);

  return { logs, exitCode, isRunning, completedRunId, completedSummary, reset, prependBufferedLogs };
}
