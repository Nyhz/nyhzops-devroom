'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSocket, useReconnectKey } from '@/hooks/use-socket';

const MAX_EVENTS = 30;

export interface ActivityEvent {
  type: string;
  battlefieldCodename: string;
  missionTitle: string;
  timestamp: number;
  detail: string;
}

export function useActivityFeed(): ActivityEvent[] {
  const socket = useSocket();
  const reconnectKey = useReconnectKey();
  const [events, setEvents] = useState<ActivityEvent[]>([]);

  const handleEvent = useCallback((event: ActivityEvent) => {
    setEvents(prev => {
      const next = [event, ...prev];
      return next.slice(0, MAX_EVENTS);
    });
  }, []);

  useEffect(() => {
    if (!socket) return;

    socket.emit('hq:subscribe');
    socket.on('activity:event', handleEvent);

    return () => {
      socket.off('activity:event', handleEvent);
      socket.emit('hq:unsubscribe');
    };
  }, [socket, handleEvent, reconnectKey]);

  return events;
}
