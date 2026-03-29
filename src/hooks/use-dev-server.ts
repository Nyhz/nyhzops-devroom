'use client';

import { useEffect, useState } from 'react';
import { useSocket, useReconnectKey } from '@/hooks/use-socket';

const MAX_LOGS = 500;

interface DevServerLog {
  content: string;
  timestamp: number;
}

interface DevServerState {
  status: 'running' | 'stopped' | 'crashed';
  port: number | null;
  pid: number | null;
}

export function useDevServer(battlefieldId: string, initialStatus: DevServerState) {
  const socket = useSocket();
  const reconnectKey = useReconnectKey();
  const [logs, setLogs] = useState<DevServerLog[]>([]);
  const [status, setStatus] = useState<DevServerState['status']>(initialStatus.status);
  const [port, setPort] = useState<number | null>(initialStatus.port);
  const [pid, setPid] = useState<number | null>(initialStatus.pid);

  useEffect(() => {
    if (!socket) return;

    socket.emit('devserver:subscribe', battlefieldId);

    const handleLog = (data: { battlefieldId: string; content: string; timestamp: number }) => {
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

    const handleStatus = (data: {
      battlefieldId: string;
      status: DevServerState['status'];
      port: number | null;
      pid: number | null;
    }) => {
      if (data.battlefieldId === battlefieldId) {
        setStatus(data.status);
        setPort(data.port);
        setPid(data.pid);
      }
    };

    socket.on('devserver:log', handleLog);
    socket.on('devserver:status', handleStatus);

    return () => {
      socket.off('devserver:log', handleLog);
      socket.off('devserver:status', handleStatus);
      socket.emit('devserver:unsubscribe', battlefieldId);
    };
  }, [socket, battlefieldId, reconnectKey]);

  return { logs, status, port, pid };
}
