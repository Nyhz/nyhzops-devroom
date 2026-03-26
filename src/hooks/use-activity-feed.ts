'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSocket } from '@/hooks/use-socket';

const MAX_EVENTS = 50;

export interface ActivityEvent {
  type: string;
  battlefieldCodename: string;
  missionTitle: string;
  timestamp: number;
  detail: string;
}

export function useActivityFeed(): ActivityEvent[] {
  const socket = useSocket();
  const [events, setEvents] = useState<ActivityEvent[]>([]);

  const handleEvent = useCallback((event: ActivityEvent) => {
    setEvents(prev => {
      const next = [...prev, event];
      if (next.length > MAX_EVENTS) {
        return next.slice(next.length - MAX_EVENTS);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!socket) return;

    socket.emit('hq:subscribe');
    socket.on('activity:event', handleEvent);

    return () => {
      socket.off('activity:event', handleEvent);
    };
  }, [socket, handleEvent]);

  return events;
}
