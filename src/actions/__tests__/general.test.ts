import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getTestDb, closeTestDb } from '@/lib/test/db';
import {
  createTestBattlefield,
  createTestGeneralSession,
  createTestGeneralMessage,
} from '@/lib/test/fixtures';
import type Database from 'better-sqlite3';
import type { DB } from '@/lib/db/index';

let db: DB;
let sqlite: Database.Database;

vi.mock('@/lib/db/index', () => ({
  getDatabase: () => db,
}));

vi.mock('@/lib/general/general-engine', () => ({
  killSession: vi.fn(),
}));

const {
  createGeneralSession,
  closeGeneralSession,
  renameGeneralSession,
  getActiveSessions,
  getSessionMessages,
} = await import('@/actions/general');

describe('general actions', () => {
  beforeEach(() => {
    const testDb = getTestDb();
    db = testDb.db;
    sqlite = testDb.sqlite;
  });

  afterEach(() => {
    closeTestDb(sqlite);
  });

  // ---------------------------------------------------------------------------
  // createGeneralSession
  // ---------------------------------------------------------------------------
  describe('createGeneralSession', () => {
    it('creates a session with name', async () => {
      const session = await createGeneralSession('Ops Chat');

      expect(session).toBeDefined();
      expect(session.name).toBe('Ops Chat');
      expect(session.status).toBe('active');
      expect(session.sessionId).toBeNull();
      expect(session.battlefieldId).toBeNull();
    });

    it('creates a session linked to a battlefield', async () => {
      const bf = createTestBattlefield(db);
      const session = await createGeneralSession('BF Chat', bf.id);

      expect(session.battlefieldId).toBe(bf.id);
    });

    it('handles null battlefieldId', async () => {
      const session = await createGeneralSession('Solo Chat', null);
      expect(session.battlefieldId).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // closeGeneralSession
  // ---------------------------------------------------------------------------
  describe('closeGeneralSession', () => {
    it('sets session status to closed', async () => {
      const session = createTestGeneralSession(db, { name: 'To Close' });

      await closeGeneralSession(session.id);

      const active = await getActiveSessions();
      expect(active.find((s) => s.id === session.id)).toBeUndefined();
    });

    it('calls killSession on the engine', async () => {
      const { killSession } = await import('@/lib/general/general-engine');
      const session = createTestGeneralSession(db, { name: 'Kill Me' });

      await closeGeneralSession(session.id);

      expect(killSession).toHaveBeenCalledWith(session.id);
    });
  });

  // ---------------------------------------------------------------------------
  // renameGeneralSession
  // ---------------------------------------------------------------------------
  describe('renameGeneralSession', () => {
    it('renames a session', async () => {
      const session = createTestGeneralSession(db, { name: 'Old Name' });

      await renameGeneralSession(session.id, 'New Name');

      const sessions = await getActiveSessions();
      const updated = sessions.find((s) => s.id === session.id);
      expect(updated).toBeDefined();
      expect(updated!.name).toBe('New Name');
    });
  });

  // ---------------------------------------------------------------------------
  // getActiveSessions
  // ---------------------------------------------------------------------------
  describe('getActiveSessions', () => {
    it('returns empty when no sessions', async () => {
      const sessions = await getActiveSessions();
      expect(sessions).toEqual([]);
    });

    it('returns only active sessions', async () => {
      createTestGeneralSession(db, { name: 'Active 1', status: 'active', createdAt: 1000, updatedAt: 1000 });
      createTestGeneralSession(db, { name: 'Active 2', status: 'active', createdAt: 2000, updatedAt: 2000 });
      createTestGeneralSession(db, { name: 'Closed', status: 'closed', createdAt: 3000, updatedAt: 3000 });

      const sessions = await getActiveSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions.every((s) => s.status === 'active')).toBe(true);
    });

    it('returns sessions ordered by createdAt', async () => {
      createTestGeneralSession(db, { name: 'Second', createdAt: 2000, updatedAt: 2000 });
      createTestGeneralSession(db, { name: 'First', createdAt: 1000, updatedAt: 1000 });

      const sessions = await getActiveSessions();
      expect(sessions[0].name).toBe('First');
      expect(sessions[1].name).toBe('Second');
    });
  });

  // ---------------------------------------------------------------------------
  // getSessionMessages
  // ---------------------------------------------------------------------------
  describe('getSessionMessages', () => {
    it('returns empty when no messages', async () => {
      const session = createTestGeneralSession(db);
      const messages = await getSessionMessages(session.id);
      expect(messages).toEqual([]);
    });

    it('returns messages ordered by timestamp', async () => {
      const session = createTestGeneralSession(db);

      createTestGeneralMessage(db, { sessionId: session.id, content: 'First', timestamp: 1000 });
      createTestGeneralMessage(db, { sessionId: session.id, content: 'Second', timestamp: 2000 });
      createTestGeneralMessage(db, { sessionId: session.id, content: 'Third', timestamp: 3000 });

      const messages = await getSessionMessages(session.id);
      expect(messages).toHaveLength(3);
      expect(messages[0].content).toBe('First');
      expect(messages[1].content).toBe('Second');
      expect(messages[2].content).toBe('Third');
    });

    it('returns messages with correct roles', async () => {
      const session = createTestGeneralSession(db);

      createTestGeneralMessage(db, { sessionId: session.id, role: 'commander', timestamp: 1000 });
      createTestGeneralMessage(db, { sessionId: session.id, role: 'general', timestamp: 2000 });
      createTestGeneralMessage(db, { sessionId: session.id, role: 'system', timestamp: 3000 });

      const messages = await getSessionMessages(session.id);
      expect(messages[0].role).toBe('commander');
      expect(messages[1].role).toBe('general');
      expect(messages[2].role).toBe('system');
    });

    it('does not return messages from other sessions', async () => {
      const s1 = createTestGeneralSession(db, { name: 'S1' });
      const s2 = createTestGeneralSession(db, { name: 'S2' });

      createTestGeneralMessage(db, { sessionId: s1.id, content: 'S1 msg' });
      createTestGeneralMessage(db, { sessionId: s2.id, content: 'S2 msg' });

      const messages = await getSessionMessages(s1.id);
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('S1 msg');
    });
  });
});
