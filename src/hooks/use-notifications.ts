'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSocket, useReconnectKey } from '@/hooks/use-socket';
import {
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllRead as markAllReadAction,
} from '@/actions/notification';
import type { Notification, NotificationLevel } from '@/types';

interface SocketNotification {
  id: string;
  level: NotificationLevel;
  title: string;
  detail: string;
  entityType?: string;
  entityId?: string;
  battlefieldId?: string;
  timestamp: number;
}

export function useNotifications() {
  const socket = useSocket();
  const reconnectKey = useReconnectKey();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // Fetch initial data on mount
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const [items, count] = await Promise.all([
          getNotifications(10),
          getUnreadCount(),
        ]);
        if (!cancelled) {
          setNotifications(items);
          setUnreadCount(count);
        }
      } catch {
        // Silently fail — not critical
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  // Subscribe to Socket.IO events
  useEffect(() => {
    if (!socket) return;

    socket.emit('hq:subscribe');

    const handleNotification = (data: SocketNotification) => {
      const newNotification: Notification = {
        id: data.id,
        level: data.level,
        title: data.title,
        detail: data.detail,
        entityType: data.entityType ?? null,
        entityId: data.entityId ?? null,
        battlefieldId: data.battlefieldId ?? null,
        read: 0,
        telegramSent: 0,
        telegramMsgId: null,
        createdAt: data.timestamp,
      };

      setNotifications((prev) => [newNotification, ...prev].slice(0, 10));
      setUnreadCount((prev) => prev + 1);
    };

    socket.on('notification:new', handleNotification);

    return () => {
      socket.off('notification:new', handleNotification);
      socket.emit('hq:unsubscribe');
    };
  }, [socket, reconnectKey]);

  const markAsRead = useCallback(async (id: string) => {
    await markNotificationRead(id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: 1 } : n)),
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));
  }, []);

  const markAllRead = useCallback(async () => {
    await markAllReadAction();
    setNotifications((prev) => prev.map((n) => ({ ...n, read: 1 })));
    setUnreadCount(0);
  }, []);

  return { notifications, unreadCount, markAsRead, markAllRead };
}
