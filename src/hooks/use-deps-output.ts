'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSocket, useReconnectKey } from '@/hooks/use-socket';

const MAX_LOGS = 500;

interface DepsLog {
  content: string;
  timestamp: number;
}

export function useDepsOutput(battlefieldId: string) {
  const socket = useSocket();
  const reconnectKey = useReconnectKey();
  const [logs, setLogs] = useState<DepsLog[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    if (!socket) return;

    socket.emit('deps:subscribe', battlefieldId);

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

    socket.on('console:output', handleOutput);
    socket.on('console:exit', handleExit);

    return () => {
      socket.off('console:output', handleOutput);
      socket.off('console:exit', handleExit);
      socket.emit('deps:unsubscribe', battlefieldId);
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
  }, []);

  return { logs, exitCode, isRunning, prependBufferedLogs, reset };
}
