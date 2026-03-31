// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useNotifications } from '@/hooks/use-notifications';
import { mockSocket } from '@/lib/test/component-setup';

// Mock server actions
vi.mock('@/actions/notification', () => ({
  getNotifications: vi.fn().mockResolvedValue([]),
  getUnreadCount: vi.fn().mockResolvedValue(0),
  markNotificationRead: vi.fn().mockResolvedValue(undefined),
  markAllRead: vi.fn().mockResolvedValue(undefined),
}));

import {
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllRead as markAllReadAction,
} from '@/actions/notification';

const mockGetNotifications = getNotifications as ReturnType<typeof vi.fn>;
const mockGetUnreadCount = getUnreadCount as ReturnType<typeof vi.fn>;
const mockMarkNotificationRead = markNotificationRead as ReturnType<typeof vi.fn>;
const mockMarkAllReadAction = markAllReadAction as ReturnType<typeof vi.fn>;

function makeNotification(id: string, read = 0) {
  return {
    id,
    level: 'info' as const,
    title: `Notification ${id}`,
    detail: `Detail ${id}`,
    entityType: null,
    entityId: null,
    battlefieldId: null,
    read,
    telegramSent: 0,
    telegramMsgId: null,
    createdAt: Date.now(),
  };
}

describe('useNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetNotifications.mockResolvedValue([]);
    mockGetUnreadCount.mockResolvedValue(0);
  });

  it('fetches initial notifications and unread count on mount', async () => {
    const items = [makeNotification('n1'), makeNotification('n2')];
    mockGetNotifications.mockResolvedValue(items);
    mockGetUnreadCount.mockResolvedValue(2);

    const { result } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(2);
    });
    expect(result.current.unreadCount).toBe(2);
    expect(mockGetNotifications).toHaveBeenCalledWith(10);
    expect(mockGetUnreadCount).toHaveBeenCalled();
  });

  it('starts with empty notifications and zero unread count', () => {
    const { result } = renderHook(() => useNotifications());
    expect(result.current.notifications).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
  });

  it('subscribes to hq on mount and unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useNotifications());
    expect(mockSocket.emit).toHaveBeenCalledWith('hq:subscribe');
    expect(mockSocket.on).toHaveBeenCalledWith('notification:new', expect.any(Function));

    unmount();
    expect(mockSocket.off).toHaveBeenCalledWith('notification:new', expect.any(Function));
    expect(mockSocket.emit).toHaveBeenCalledWith('hq:unsubscribe');
  });

  it('handles incoming socket notification', async () => {
    mockGetNotifications.mockResolvedValue([]);
    mockGetUnreadCount.mockResolvedValue(0);

    const { result } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(mockSocket.on).toHaveBeenCalled();
    });

    // Get the registered handler
    const onCall = mockSocket.on.mock.calls.find(
      (c: unknown[]) => c[0] === 'notification:new',
    );
    expect(onCall).toBeDefined();
    const handler = onCall![1] as (data: unknown) => void;

    // Simulate incoming notification
    act(() => {
      handler({
        id: 'socket-n1',
        level: 'warning',
        title: 'New Alert',
        detail: 'Something happened',
        timestamp: Date.now(),
      });
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].id).toBe('socket-n1');
    expect(result.current.notifications[0].level).toBe('warning');
    expect(result.current.notifications[0].read).toBe(0);
    expect(result.current.unreadCount).toBe(1);
  });

  it('limits notifications to 10 items', async () => {
    const initial = Array.from({ length: 10 }, (_, i) => makeNotification(`n${i}`));
    mockGetNotifications.mockResolvedValue(initial);
    mockGetUnreadCount.mockResolvedValue(10);

    const { result } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(10);
    });

    // Get the handler and add one more
    const onCall = mockSocket.on.mock.calls.find(
      (c: unknown[]) => c[0] === 'notification:new',
    );
    const handler = onCall![1] as (data: unknown) => void;

    act(() => {
      handler({
        id: 'overflow',
        level: 'info',
        title: 'Overflow',
        detail: 'Extra',
        timestamp: Date.now(),
      });
    });

    // Should still be 10 (newest first, oldest dropped)
    expect(result.current.notifications).toHaveLength(10);
    expect(result.current.notifications[0].id).toBe('overflow');
  });

  it('marks a single notification as read', async () => {
    const items = [makeNotification('n1'), makeNotification('n2')];
    mockGetNotifications.mockResolvedValue(items);
    mockGetUnreadCount.mockResolvedValue(2);

    const { result } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(2);
    });

    await act(async () => {
      await result.current.markAsRead('n1');
    });

    expect(mockMarkNotificationRead).toHaveBeenCalledWith('n1');
    expect(result.current.notifications.find((n) => n.id === 'n1')?.read).toBe(1);
    expect(result.current.notifications.find((n) => n.id === 'n2')?.read).toBe(0);
    expect(result.current.unreadCount).toBe(1);
  });

  it('marks all notifications as read', async () => {
    const items = [makeNotification('n1'), makeNotification('n2')];
    mockGetNotifications.mockResolvedValue(items);
    mockGetUnreadCount.mockResolvedValue(2);

    const { result } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(2);
    });

    await act(async () => {
      await result.current.markAllRead();
    });

    expect(mockMarkAllReadAction).toHaveBeenCalled();
    expect(result.current.notifications.every((n) => n.read === 1)).toBe(true);
    expect(result.current.unreadCount).toBe(0);
  });

  it('unread count does not go below zero', async () => {
    mockGetNotifications.mockResolvedValue([makeNotification('n1', 1)]); // already read
    mockGetUnreadCount.mockResolvedValue(0);

    const { result } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(1);
    });

    await act(async () => {
      await result.current.markAsRead('n1');
    });

    expect(result.current.unreadCount).toBe(0);
  });

  it('handles fetch error gracefully', async () => {
    mockGetNotifications.mockRejectedValue(new Error('Network error'));
    mockGetUnreadCount.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useNotifications());

    // Should not throw and state stays at defaults
    await waitFor(() => {
      expect(result.current.notifications).toEqual([]);
      expect(result.current.unreadCount).toBe(0);
    });
  });
});
