'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSocket } from '@/hooks/use-socket';

interface CommandLog {
  content: string;
  timestamp: number;
}

export function useCommandOutput(battlefieldId: string) {
  const socket = useSocket();
  const [logs, setLogs] = useState<CommandLog[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [isRunning, setIsRunning] = useState(true);

  useEffect(() => {
    if (!socket) return;

    socket.emit('console:subscribe', battlefieldId);

    const handleOutput = (data: { battlefieldId: string; content: string; timestamp: number }) => {
      if (data.battlefieldId === battlefieldId) {
        setLogs(prev => [...prev, { content: data.content, timestamp: data.timestamp }]);
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
      socket.emit('console:unsubscribe', battlefieldId);
    };
  }, [socket, battlefieldId]);

  const prependBufferedLogs = useCallback((buffered: string) => {
    if (!buffered) return;
    const lines = buffered.split('\n').filter(Boolean);
    const bufferedLogs = lines.map((content, i) => ({
      content: content + '\n',
      timestamp: i,  // synthetic timestamps for ordering
    }));
    setLogs(prev => {
      if (prev.length === 0 || prev[0].timestamp > 100) {
        return [...bufferedLogs, ...prev];
      }
      return prev;
    });
  }, []);

  return { logs, exitCode, isRunning, prependBufferedLogs };
}
