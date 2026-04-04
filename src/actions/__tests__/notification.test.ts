import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getTestDb, closeTestDb } from '@/lib/test/db';
import { createTestNotification } from '@/lib/test/fixtures';
import type Database from 'better-sqlite3';
import type { DB } from '@/lib/db/index';

let db: DB;
let sqlite: Database.Database;

vi.mock('@/lib/db/index', () => ({
  getDatabase: () => db,
}));

const { getNotifications, markNotificationRead, markAllRead, getUnreadCount } =
  await import('@/actions/notification');

describe('notification actions', () => {
  beforeEach(() => {
    const testDb = getTestDb();
    db = testDb.db;
    sqlite = testDb.sqlite;
  });

  afterEach(() => {
    closeTestDb(sqlite);
  });

  // ---------------------------------------------------------------------------
  // getNotifications
  // ---------------------------------------------------------------------------
  describe('getNotifications', () => {
    it('returns empty array when no notifications exist', async () => {
      const result = await getNotifications();
      expect(result).toEqual([]);
    });

    it('returns all notifications ordered by createdAt desc', async () => {
      const _n1 = createTestNotification(db, { title: 'First', createdAt: 1000 });
      const _n2 = createTestNotification(db, { title: 'Second', createdAt: 2000 });
      const _n3 = createTestNotification(db, { title: 'Third', createdAt: 3000 });

      const result = await getNotifications();
      expect(result).toHaveLength(3);
      expect(result[0].title).toBe('Third');
      expect(result[1].title).toBe('Second');
      expect(result[2].title).toBe('First');
    });

    it('respects limit parameter', async () => {
      createTestNotification(db, { title: 'A', createdAt: 1000 });
      createTestNotification(db, { title: 'B', createdAt: 2000 });
      createTestNotification(db, { title: 'C', createdAt: 3000 });

      const result = await getNotifications(2);
      expect(result).toHaveLength(2);
    });

    it('filters unread only when flag is true', async () => {
      createTestNotification(db, { title: 'Unread', read: 0, createdAt: 1000 });
      createTestNotification(db, { title: 'Read', read: 1, createdAt: 2000 });

      const result = await getNotifications(50, true);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Unread');
    });

    it('returns all when unreadOnly is false', async () => {
      createTestNotification(db, { title: 'Unread', read: 0, createdAt: 1000 });
      createTestNotification(db, { title: 'Read', read: 1, createdAt: 2000 });

      const result = await getNotifications(50, false);
      expect(result).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // markNotificationRead
  // ---------------------------------------------------------------------------
  describe('markNotificationRead', () => {
    it('marks a single notification as read', async () => {
      const n = createTestNotification(db, { read: 0 });

      await markNotificationRead(n.id);

      const result = await getNotifications();
      expect(result[0].read).toBe(1);
    });

    it('does not affect other notifications', async () => {
      const n1 = createTestNotification(db, { title: 'A', read: 0, createdAt: 1000 });
      const n2 = createTestNotification(db, { title: 'B', read: 0, createdAt: 2000 });

      await markNotificationRead(n1.id);

      const result = await getNotifications(50, true);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(n2.id);
    });
  });

  // ---------------------------------------------------------------------------
  // markAllRead
  // ---------------------------------------------------------------------------
  describe('markAllRead', () => {
    it('marks all unread notifications as read', async () => {
      createTestNotification(db, { read: 0, createdAt: 1000 });
      createTestNotification(db, { read: 0, createdAt: 2000 });
      createTestNotification(db, { read: 1, createdAt: 3000 });

      await markAllRead();

      const unread = await getNotifications(50, true);
      expect(unread).toHaveLength(0);

      const all = await getNotifications();
      expect(all).toHaveLength(3);
      expect(all.every((n) => n.read === 1)).toBe(true);
    });

    it('no-ops when no unread notifications', async () => {
      createTestNotification(db, { read: 1 });

      await markAllRead();

      const all = await getNotifications();
      expect(all).toHaveLength(1);
      expect(all[0].read).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // getUnreadCount
  // ---------------------------------------------------------------------------
  describe('getUnreadCount', () => {
    it('returns 0 when no notifications', async () => {
      const count = await getUnreadCount();
      expect(count).toBe(0);
    });

    it('counts only unread notifications', async () => {
      createTestNotification(db, { read: 0, createdAt: 1000 });
      createTestNotification(db, { read: 0, createdAt: 2000 });
      createTestNotification(db, { read: 1, createdAt: 3000 });

      const count = await getUnreadCount();
      expect(count).toBe(2);
    });

    it('returns 0 when all are read', async () => {
      createTestNotification(db, { read: 1 });

      const count = await getUnreadCount();
      expect(count).toBe(0);
    });
  });
});
