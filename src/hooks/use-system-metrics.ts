'use client';

import { useEffect, useState } from 'react';
import { useSocket, useReconnectKey } from '@/hooks/use-socket';
import type { SystemMetrics } from '@/types';

export function useSystemMetrics() {
  const socket = useSocket();
  const reconnectKey = useReconnectKey();
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);

  useEffect(() => {
    if (!socket) return;

    socket.emit('system:subscribe');

    const handleMetrics = (data: SystemMetrics) => {
      setMetrics(data);
    };

    socket.on('system:metrics', handleMetrics);

    return () => {
      socket.off('system:metrics', handleMetrics);
      socket.emit('system:unsubscribe');
    };
  }, [socket, reconnectKey]);

  return metrics;
}
