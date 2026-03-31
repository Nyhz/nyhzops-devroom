import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getTestDb, closeTestDb } from '@/lib/test/db';
import {
  createTestBattlefield,
  createTestCampaign,
  createTestBriefingSession,
  createTestBriefingMessage,
} from '@/lib/test/fixtures';
import type Database from 'better-sqlite3';
import type { DB } from '@/lib/db/index';

let db: DB;
let sqlite: Database.Database;

vi.mock('@/lib/db/index', () => ({
  getDatabase: () => db,
}));

const { getBriefingMessages, getBriefingSession } = await import('@/actions/briefing');

describe('briefing actions', () => {
  beforeEach(() => {
    const testDb = getTestDb();
    db = testDb.db;
    sqlite = testDb.sqlite;
  });

  afterEach(() => {
    closeTestDb(sqlite);
  });

  // ---------------------------------------------------------------------------
  // getBriefingSession
  // ---------------------------------------------------------------------------
  describe('getBriefingSession', () => {
    it('returns null when no session exists for campaign', async () => {
      const result = await getBriefingSession('nonexistent');
      expect(result).toBeNull();
    });

    it('returns the session for a campaign', async () => {
      const bf = createTestBattlefield(db);
      const campaign = createTestCampaign(db, { battlefieldId: bf.id });
      const session = createTestBriefingSession(db, { campaignId: campaign.id });

      const result = await getBriefingSession(campaign.id);
      expect(result).toBeDefined();
      expect(result!.id).toBe(session.id);
      expect(result!.campaignId).toBe(campaign.id);
    });
  });

  // ---------------------------------------------------------------------------
  // getBriefingMessages
  // ---------------------------------------------------------------------------
  describe('getBriefingMessages', () => {
    it('returns empty when no session exists', async () => {
      const messages = await getBriefingMessages('nonexistent-campaign');
      expect(messages).toEqual([]);
    });

    it('returns empty when session exists but no messages', async () => {
      const bf = createTestBattlefield(db);
      const campaign = createTestCampaign(db, { battlefieldId: bf.id });
      createTestBriefingSession(db, { campaignId: campaign.id });

      const messages = await getBriefingMessages(campaign.id);
      expect(messages).toEqual([]);
    });

    it('returns messages ordered by timestamp', async () => {
      const bf = createTestBattlefield(db);
      const campaign = createTestCampaign(db, { battlefieldId: bf.id });
      const session = createTestBriefingSession(db, { campaignId: campaign.id });

      createTestBriefingMessage(db, { briefingId: session.id, content: 'First', timestamp: 1000 });
      createTestBriefingMessage(db, { briefingId: session.id, content: 'Second', timestamp: 2000 });
      createTestBriefingMessage(db, { briefingId: session.id, content: 'Third', timestamp: 3000 });

      const messages = await getBriefingMessages(campaign.id);
      expect(messages).toHaveLength(3);
      expect(messages[0].content).toBe('First');
      expect(messages[1].content).toBe('Second');
      expect(messages[2].content).toBe('Third');
    });

    it('returns messages with correct roles', async () => {
      const bf = createTestBattlefield(db);
      const campaign = createTestCampaign(db, { battlefieldId: bf.id });
      const session = createTestBriefingSession(db, { campaignId: campaign.id });

      createTestBriefingMessage(db, {
        briefingId: session.id,
        role: 'commander',
        content: 'Plan the attack',
        timestamp: 1000,
      });
      createTestBriefingMessage(db, {
        briefingId: session.id,
        role: 'general',
        content: 'Roger that',
        timestamp: 2000,
      });

      const messages = await getBriefingMessages(campaign.id);
      expect(messages[0].role).toBe('commander');
      expect(messages[1].role).toBe('general');
    });
  });
});
