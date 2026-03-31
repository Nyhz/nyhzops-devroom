import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getTestDb, closeTestDb, type TestDB } from '@/lib/test/db';
import {
  createTestBattlefield,
  createTestMission,
  createTestCampaign,
  createTestFollowUpSuggestion,
} from '@/lib/test/fixtures';
import { followUpSuggestions, intelNotes } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type Database from 'better-sqlite3';

let db: TestDB;
let sqlite: Database.Database;

// Mock the DB module to inject test database
vi.mock('@/lib/db/index', () => ({
  getDatabase: () => db,
  getOrThrow: (table: { id: unknown }, id: string, label: string) => {
    const row = db.select().from(table).where(eq(table.id, id)).get();
    if (!row) throw new Error(`${label}: ${id} not found`);
    return row;
  },
}));

// Mock generateId
let idCounter = 0;
vi.mock('@/lib/utils', () => ({
  generateId: () => `TEST-${String(++idCounter).padStart(6, '0')}`,
}));

// Import actions AFTER mocks
import {
  extractAndSaveSuggestions,
  addSuggestionToBoard,
  dismissSuggestion,
  getSuggestions,
} from '@/actions/follow-up';

describe('follow-up actions', () => {
  let battlefield: ReturnType<typeof createTestBattlefield>;

  beforeEach(() => {
    const testDb = getTestDb();
    db = testDb.db;
    sqlite = testDb.sqlite;
    idCounter = 0;
    battlefield = createTestBattlefield(db);
  });

  afterEach(() => {
    closeTestDb(sqlite);
  });

  // -------------------------------------------------------------------------
  // extractAndSaveSuggestions
  // -------------------------------------------------------------------------
  describe('extractAndSaveSuggestions', () => {
    it('extracts and saves suggestions from a debrief with next actions', async () => {
      const debrief = `## Summary
Done.

## Recommended Next Actions
- Add error handling
- Write more tests
- Update docs`;

      const results = await extractAndSaveSuggestions({
        battlefieldId: battlefield.id,
        debrief,
      });

      expect(results).toHaveLength(3);
      expect(results[0].suggestion).toBe('Add error handling');
      expect(results[1].suggestion).toBe('Write more tests');
      expect(results[2].suggestion).toBe('Update docs');
      expect(results[0].status).toBe('pending');
      expect(results[0].battlefieldId).toBe(battlefield.id);
    });

    it('returns empty array when debrief has no next actions section', async () => {
      const debrief = `## Summary
Everything went fine. No follow-ups needed.`;

      const results = await extractAndSaveSuggestions({
        battlefieldId: battlefield.id,
        debrief,
      });

      expect(results).toEqual([]);
    });

    it('associates suggestions with a mission when missionId is provided', async () => {
      const mission = createTestMission(db, { battlefieldId: battlefield.id });
      const debrief = `## Next Steps
- Fix the bug`;

      const results = await extractAndSaveSuggestions({
        battlefieldId: battlefield.id,
        missionId: mission.id,
        debrief,
      });

      expect(results).toHaveLength(1);
      expect(results[0].missionId).toBe(mission.id);
    });

    it('associates suggestions with a campaign when campaignId is provided', async () => {
      const campaign = createTestCampaign(db, { battlefieldId: battlefield.id });
      const debrief = `## Recommended Next Actions
- Scale the infrastructure`;

      const results = await extractAndSaveSuggestions({
        battlefieldId: battlefield.id,
        campaignId: campaign.id,
        debrief,
      });

      expect(results).toHaveLength(1);
      expect(results[0].campaignId).toBe(campaign.id);
    });

    it('sets missionId and campaignId to null when not provided', async () => {
      const debrief = `## Next Actions
- Do something`;

      const results = await extractAndSaveSuggestions({
        battlefieldId: battlefield.id,
        debrief,
      });

      expect(results[0].missionId).toBeNull();
      expect(results[0].campaignId).toBeNull();
    });

    it('persists suggestions to the database', async () => {
      const debrief = `## Recommended Next Actions
- First
- Second`;

      await extractAndSaveSuggestions({
        battlefieldId: battlefield.id,
        debrief,
      });

      const rows = db.select().from(followUpSuggestions).all();
      expect(rows).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // addSuggestionToBoard
  // -------------------------------------------------------------------------
  describe('addSuggestionToBoard', () => {
    it('creates an intel note and marks suggestion as added', async () => {
      const suggestion = createTestFollowUpSuggestion(db, {
        battlefieldId: battlefield.id,
        suggestion: 'Deploy monitoring',
      });

      await addSuggestionToBoard(suggestion.id);

      // Check suggestion was updated
      const updated = db
        .select()
        .from(followUpSuggestions)
        .where(eq(followUpSuggestions.id, suggestion.id))
        .get();
      expect(updated!.status).toBe('added');
      expect(updated!.intelNoteId).toBeTruthy();

      // Check intel note was created
      const notes = db
        .select()
        .from(intelNotes)
        .where(eq(intelNotes.battlefieldId, battlefield.id))
        .all();
      expect(notes).toHaveLength(1);
      expect(notes[0].title).toBe('Deploy monitoring');
      expect(notes[0].column).toBe('backlog');
    });

    it('throws on non-existent suggestion', async () => {
      await expect(addSuggestionToBoard('missing')).rejects.toThrow('not found');
    });
  });

  // -------------------------------------------------------------------------
  // dismissSuggestion
  // -------------------------------------------------------------------------
  describe('dismissSuggestion', () => {
    it('sets status to dismissed', async () => {
      const suggestion = createTestFollowUpSuggestion(db, {
        battlefieldId: battlefield.id,
      });

      await dismissSuggestion(suggestion.id);

      const updated = db
        .select()
        .from(followUpSuggestions)
        .where(eq(followUpSuggestions.id, suggestion.id))
        .get();
      expect(updated!.status).toBe('dismissed');
    });

    it('updates the updatedAt timestamp', async () => {
      const suggestion = createTestFollowUpSuggestion(db, {
        battlefieldId: battlefield.id,
        updatedAt: 1000,
      });

      await dismissSuggestion(suggestion.id);

      const updated = db
        .select()
        .from(followUpSuggestions)
        .where(eq(followUpSuggestions.id, suggestion.id))
        .get();
      expect(updated!.updatedAt).toBeGreaterThan(1000);
    });

    it('throws on non-existent suggestion', async () => {
      await expect(dismissSuggestion('missing')).rejects.toThrow('not found');
    });
  });

  // -------------------------------------------------------------------------
  // getSuggestions
  // -------------------------------------------------------------------------
  describe('getSuggestions', () => {
    it('returns suggestions filtered by missionId', async () => {
      const mission = createTestMission(db, { battlefieldId: battlefield.id });
      createTestFollowUpSuggestion(db, {
        battlefieldId: battlefield.id,
        missionId: mission.id,
        suggestion: 'Mission suggestion',
      });
      // Unrelated suggestion
      createTestFollowUpSuggestion(db, {
        battlefieldId: battlefield.id,
        suggestion: 'Unrelated',
      });

      const results = await getSuggestions({ missionId: mission.id });
      expect(results).toHaveLength(1);
      expect(results[0].suggestion).toBe('Mission suggestion');
    });

    it('returns suggestions filtered by campaignId', async () => {
      const campaign = createTestCampaign(db, { battlefieldId: battlefield.id });
      createTestFollowUpSuggestion(db, {
        battlefieldId: battlefield.id,
        campaignId: campaign.id,
        suggestion: 'Campaign suggestion',
      });

      const results = await getSuggestions({ campaignId: campaign.id });
      expect(results).toHaveLength(1);
      expect(results[0].suggestion).toBe('Campaign suggestion');
    });

    it('returns empty array when neither missionId nor campaignId provided', async () => {
      createTestFollowUpSuggestion(db, { battlefieldId: battlefield.id });

      const results = await getSuggestions({});
      expect(results).toEqual([]);
    });

    it('prioritizes missionId when both are provided', async () => {
      const mission = createTestMission(db, { battlefieldId: battlefield.id });
      const campaign = createTestCampaign(db, { battlefieldId: battlefield.id });
      createTestFollowUpSuggestion(db, {
        battlefieldId: battlefield.id,
        missionId: mission.id,
        suggestion: 'Mission one',
      });
      createTestFollowUpSuggestion(db, {
        battlefieldId: battlefield.id,
        campaignId: campaign.id,
        suggestion: 'Campaign one',
      });

      // When both are provided, missionId takes precedence (code checks missionId first)
      const results = await getSuggestions({ missionId: mission.id, campaignId: campaign.id });
      expect(results).toHaveLength(1);
      expect(results[0].suggestion).toBe('Mission one');
    });

    it('orders suggestions by createdAt ascending', async () => {
      const mission = createTestMission(db, { battlefieldId: battlefield.id });
      createTestFollowUpSuggestion(db, {
        battlefieldId: battlefield.id,
        missionId: mission.id,
        suggestion: 'Older',
        createdAt: 1000,
      });
      createTestFollowUpSuggestion(db, {
        battlefieldId: battlefield.id,
        missionId: mission.id,
        suggestion: 'Newer',
        createdAt: 2000,
      });

      const results = await getSuggestions({ missionId: mission.id });
      expect(results[0].suggestion).toBe('Older');
      expect(results[1].suggestion).toBe('Newer');
    });
  });
});
