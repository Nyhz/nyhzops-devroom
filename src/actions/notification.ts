'use server';

import { eq, desc, count } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { notifications } from '@/lib/db/schema';
import type { Notification } from '@/types';

// ---------------------------------------------------------------------------
// getNotifications
// ---------------------------------------------------------------------------

export async function getNotifications(
  limit = 50,
  unreadOnly = false,
): Promise<Notification[]> {
  const db = getDatabase();

  if (unreadOnly) {
    return db
      .select()
      .from(notifications)
      .where(eq(notifications.read, 0))
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .all();
  }

  return db
    .select()
    .from(notifications)
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .all();
}

// ---------------------------------------------------------------------------
// markNotificationRead
// ---------------------------------------------------------------------------

export async function markNotificationRead(id: string): Promise<void> {
  const db = getDatabase();

  db.update(notifications)
    .set({ read: 1 })
    .where(eq(notifications.id, id))
    .run();
}

// ---------------------------------------------------------------------------
// markAllRead
// ---------------------------------------------------------------------------

export async function markAllRead(): Promise<void> {
  const db = getDatabase();

  db.update(notifications)
    .set({ read: 1 })
    .where(eq(notifications.read, 0))
    .run();
}

// ---------------------------------------------------------------------------
// getUnreadCount
// ---------------------------------------------------------------------------

export async function getUnreadCount(): Promise<number> {
  const db = getDatabase();

  const result = db
    .select({ value: count() })
    .from(notifications)
    .where(eq(notifications.read, 0))
    .get();

  return result?.value ?? 0;
}
