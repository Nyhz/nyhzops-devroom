'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import { useSocket, useReconnectKey } from '@/hooks/use-socket';

interface ActivityEvent {
  type: string;
  battlefieldCodename: string;
  missionTitle: string;
  timestamp: number;
  detail: string;
}

export function ActivityToasts() {
  const socket = useSocket();
  const reconnectKey = useReconnectKey();

  useEffect(() => {
    if (!socket) return;

    socket.emit('hq:subscribe');

    const handleEvent = (event: ActivityEvent) => {
      if (event.type === 'mission:accomplished') {
        toast.success(event.missionTitle, {
          description: `${event.battlefieldCodename} — Mission accomplished`,
        });
      }
    };

    socket.on('activity:event', handleEvent);

    return () => {
      socket.off('activity:event', handleEvent);
      socket.emit('hq:unsubscribe');
    };
  }, [socket, reconnectKey]);

  return null;
}
