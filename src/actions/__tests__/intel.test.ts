import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getTestDb, closeTestDb, type TestDB } from '@/lib/test/db';
import {
  createTestBattlefield,
  createTestMission,
  createTestCampaign,
  createTestIntelNote,
  createTestAsset,
} from '@/lib/test/fixtures';
import { intelNotes } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { createMockDbModule } from '@/lib/test/mock-db';
import type Database from 'better-sqlite3';

let db: TestDB;
let sqlite: Database.Database;

// Mock the DB module to inject test database
vi.mock('@/lib/db/index', () => createMockDbModule(() => db));

// Mock generateId to return deterministic but unique IDs
let idCounter = 0;
vi.mock('@/lib/utils', () => ({
  generateId: () => `TEST-${String(++idCounter).padStart(6, '0')}`,
}));

// Import actions AFTER mocks are set up
import {
  listBoardNotes,
  createNote,
  updateNote,
  deleteNote,
  moveNote,
  linkNoteToMission,
  linkNotesToCampaign,
  getNote,
  backfillIntelNotes,
} from '@/actions/intel';

describe('intel actions', () => {
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
  // createNote
  // -------------------------------------------------------------------------
  describe('createNote', () => {
    it('creates a note in the backlog at position 0', async () => {
      const note = await createNote(battlefield.id, 'New Intel');
      expect(note.title).toBe('New Intel');
      expect(note.column).toBe('backlog');
      expect(note.position).toBe(0);
      expect(note.battlefieldId).toBe(battlefield.id);
      expect(note.missionId).toBeNull();
      expect(note.campaignId).toBeNull();
    });

    it('trims whitespace from title', async () => {
      const note = await createNote(battlefield.id, '  Trimmed Title  ');
      expect(note.title).toBe('Trimmed Title');
    });

    it('stores description when provided', async () => {
      const note = await createNote(battlefield.id, 'With Desc', '## Markdown content');
      expect(note.description).toBe('## Markdown content');
    });

    it('sets description to null when not provided', async () => {
      const note = await createNote(battlefield.id, 'No Desc');
      expect(note.description).toBeNull();
    });

    it('shifts existing unpromoted backlog notes down', async () => {
      // Create two manual notes (no missionId)
      const first = await createNote(battlefield.id, 'First');
      const second = await createNote(battlefield.id, 'Second');

      // First should have been shifted to position 1, second is at 0
      const allNotes = db
        .select()
        .from(intelNotes)
        .where(eq(intelNotes.battlefieldId, battlefield.id))
        .all();

      const firstUpdated = allNotes.find((n) => n.id === first.id);
      const secondUpdated = allNotes.find((n) => n.id === second.id);

      expect(secondUpdated!.position).toBe(0);
      expect(firstUpdated!.position).toBe(1);
    });

    it('does not shift mission-linked notes when inserting', async () => {
      // Create a mission-linked note directly in DB
      const mission = createTestMission(db, { battlefieldId: battlefield.id });
      createTestIntelNote(db, {
        battlefieldId: battlefield.id,
        missionId: mission.id,
        column: 'backlog',
        position: 0,
      });

      // Create a manual note — should not shift the mission-linked one
      await createNote(battlefield.id, 'Manual Note');

      const missionNote = db
        .select()
        .from(intelNotes)
        .where(eq(intelNotes.missionId, mission.id))
        .get();

      expect(missionNote!.position).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // getNote
  // -------------------------------------------------------------------------
  describe('getNote', () => {
    it('returns note by ID', async () => {
      const created = createTestIntelNote(db, { battlefieldId: battlefield.id, title: 'Find Me' });
      const found = await getNote(created.id);
      expect(found.id).toBe(created.id);
      expect(found.title).toBe('Find Me');
    });

    it('throws on non-existent ID', async () => {
      await expect(getNote('nonexistent')).rejects.toThrow('not found');
    });
  });

  // -------------------------------------------------------------------------
  // updateNote
  // -------------------------------------------------------------------------
  describe('updateNote', () => {
    it('updates title', async () => {
      const note = createTestIntelNote(db, { battlefieldId: battlefield.id, title: 'Old' });
      const updated = await updateNote(note.id, { title: 'New' });
      expect(updated.title).toBe('New');
    });

    it('updates description', async () => {
      const note = createTestIntelNote(db, { battlefieldId: battlefield.id });
      const updated = await updateNote(note.id, { description: 'Updated desc' });
      expect(updated.description).toBe('Updated desc');
    });

    it('updates updatedAt timestamp', async () => {
      const note = createTestIntelNote(db, { battlefieldId: battlefield.id, updatedAt: 1000 });
      const updated = await updateNote(note.id, { title: 'Changed' });
      expect(updated.updatedAt).toBeGreaterThan(1000);
    });

    it('throws when note is linked to a mission', async () => {
      const mission = createTestMission(db, { battlefieldId: battlefield.id });
      const note = createTestIntelNote(db, {
        battlefieldId: battlefield.id,
        missionId: mission.id,
      });

      await expect(updateNote(note.id, { title: 'Nope' })).rejects.toThrow(
        'linked to a mission and cannot be edited',
      );
    });

    it('throws on non-existent note', async () => {
      await expect(updateNote('missing', { title: 'X' })).rejects.toThrow('not found');
    });
  });

  // -------------------------------------------------------------------------
  // deleteNote
  // -------------------------------------------------------------------------
  describe('deleteNote', () => {
    it('deletes a note', async () => {
      const note = createTestIntelNote(db, { battlefieldId: battlefield.id });
      await deleteNote(note.id);
      const found = db.select().from(intelNotes).where(eq(intelNotes.id, note.id)).get();
      expect(found).toBeUndefined();
    });

    it('deletes a note linked to a mission', async () => {
      const mission = createTestMission(db, { battlefieldId: battlefield.id });
      const note = createTestIntelNote(db, {
        battlefieldId: battlefield.id,
        missionId: mission.id,
      });

      await deleteNote(note.id);
      const found = db.select().from(intelNotes).where(eq(intelNotes.id, note.id)).get();
      expect(found).toBeUndefined();
    });

    it('throws on non-existent note', async () => {
      await expect(deleteNote('missing')).rejects.toThrow('not found');
    });
  });

  // -------------------------------------------------------------------------
  // moveNote
  // -------------------------------------------------------------------------
  describe('moveNote', () => {
    it('moves a note to a different column', async () => {
      const note = createTestIntelNote(db, { battlefieldId: battlefield.id, column: 'backlog' });
      const moved = await moveNote(note.id, 'planned', 5);
      expect(moved.column).toBe('planned');
      expect(moved.position).toBe(5);
    });

    it('updates position within the same column', async () => {
      const note = createTestIntelNote(db, {
        battlefieldId: battlefield.id,
        column: 'backlog',
        position: 0,
      });
      const moved = await moveNote(note.id, 'backlog', 3);
      expect(moved.column).toBe('backlog');
      expect(moved.position).toBe(3);
    });

    it('throws when note is linked to a mission', async () => {
      const mission = createTestMission(db, { battlefieldId: battlefield.id });
      const note = createTestIntelNote(db, {
        battlefieldId: battlefield.id,
        missionId: mission.id,
      });

      await expect(moveNote(note.id, 'planned', 0)).rejects.toThrow(
        'linked to a mission and cannot be moved',
      );
    });

    it('throws on non-existent note', async () => {
      await expect(moveNote('missing', 'planned', 0)).rejects.toThrow('not found');
    });
  });

  // -------------------------------------------------------------------------
  // linkNoteToMission
  // -------------------------------------------------------------------------
  describe('linkNoteToMission', () => {
    it('links a note to a mission', async () => {
      const note = createTestIntelNote(db, { battlefieldId: battlefield.id });
      const mission = createTestMission(db, { battlefieldId: battlefield.id });

      const linked = await linkNoteToMission(note.id, mission.id);
      expect(linked.missionId).toBe(mission.id);
    });

    it('updates the updatedAt timestamp', async () => {
      const note = createTestIntelNote(db, { battlefieldId: battlefield.id, updatedAt: 1000 });
      const mission = createTestMission(db, { battlefieldId: battlefield.id });

      const linked = await linkNoteToMission(note.id, mission.id);
      expect(linked.updatedAt).toBeGreaterThan(1000);
    });

    it('throws on non-existent note', async () => {
      await expect(linkNoteToMission('missing', 'any')).rejects.toThrow('not found');
    });
  });

  // -------------------------------------------------------------------------
  // linkNotesToCampaign
  // -------------------------------------------------------------------------
  describe('linkNotesToCampaign', () => {
    it('links multiple notes to a campaign', async () => {
      const campaign = createTestCampaign(db, { battlefieldId: battlefield.id });
      const note1 = createTestIntelNote(db, { battlefieldId: battlefield.id });
      const note2 = createTestIntelNote(db, { battlefieldId: battlefield.id });

      await linkNotesToCampaign([note1.id, note2.id], campaign.id);

      const updated1 = db.select().from(intelNotes).where(eq(intelNotes.id, note1.id)).get();
      const updated2 = db.select().from(intelNotes).where(eq(intelNotes.id, note2.id)).get();

      expect(updated1!.campaignId).toBe(campaign.id);
      expect(updated2!.campaignId).toBe(campaign.id);
    });

    it('does nothing with empty array', async () => {
      // Should not throw
      await linkNotesToCampaign([], 'any-campaign-id');
    });

    it('throws on non-existent first note', async () => {
      await expect(linkNotesToCampaign(['missing'], 'campaign-id')).rejects.toThrow('not found');
    });
  });

  // -------------------------------------------------------------------------
  // listBoardNotes
  // -------------------------------------------------------------------------
  describe('listBoardNotes', () => {
    it('returns notes for a battlefield', async () => {
      createTestIntelNote(db, { battlefieldId: battlefield.id, title: 'Note A' });
      createTestIntelNote(db, { battlefieldId: battlefield.id, title: 'Note B' });

      const notes = await listBoardNotes(battlefield.id);
      expect(notes).toHaveLength(2);
    });

    it('returns empty array for battlefield with no notes', async () => {
      const notes = await listBoardNotes(battlefield.id);
      expect(notes).toEqual([]);
    });

    it('does not return notes from other battlefields', async () => {
      const other = createTestBattlefield(db, { codename: 'OTHER' });
      createTestIntelNote(db, { battlefieldId: other.id, title: 'Other Note' });
      createTestIntelNote(db, { battlefieldId: battlefield.id, title: 'My Note' });

      const notes = await listBoardNotes(battlefield.id);
      expect(notes).toHaveLength(1);
      expect(notes[0].title).toBe('My Note');
    });

    it('includes joined mission data when mission is linked', async () => {
      const asset = createTestAsset(db, { codename: 'RECON' });
      const mission = createTestMission(db, {
        battlefieldId: battlefield.id,
        assetId: asset.id,
        status: 'accomplished',
      });
      createTestIntelNote(db, {
        battlefieldId: battlefield.id,
        missionId: mission.id,
      });

      const notes = await listBoardNotes(battlefield.id);
      expect(notes).toHaveLength(1);
      expect(notes[0].missionStatus).toBe('accomplished');
      expect(notes[0].missionAssetCodename).toBe('RECON');
    });

    it('returns null mission fields when no mission is linked', async () => {
      createTestIntelNote(db, { battlefieldId: battlefield.id });

      const notes = await listBoardNotes(battlefield.id);
      expect(notes[0].missionStatus).toBeNull();
      expect(notes[0].missionAssetCodename).toBeNull();
      expect(notes[0].missionCreatedAt).toBeNull();
    });

    it('orders by position then by createdAt descending', async () => {
      createTestIntelNote(db, { battlefieldId: battlefield.id, title: 'Pos1', position: 1, createdAt: 1000 });
      createTestIntelNote(db, { battlefieldId: battlefield.id, title: 'Pos0', position: 0, createdAt: 2000 });
      createTestIntelNote(db, { battlefieldId: battlefield.id, title: 'Pos0-older', position: 0, createdAt: 1000 });

      const notes = await listBoardNotes(battlefield.id);
      expect(notes.map((n) => n.title)).toEqual(['Pos0', 'Pos0-older', 'Pos1']);
    });
  });

  // -------------------------------------------------------------------------
  // backfillIntelNotes
  // -------------------------------------------------------------------------
  describe('backfillIntelNotes', () => {
    it('creates notes for missions without intel notes', async () => {
      createTestMission(db, { battlefieldId: battlefield.id, title: 'Mission A' });
      createTestMission(db, { battlefieldId: battlefield.id, title: 'Mission B' });

      const count = await backfillIntelNotes(battlefield.id);
      expect(count).toBe(2);

      const notes = db
        .select()
        .from(intelNotes)
        .where(eq(intelNotes.battlefieldId, battlefield.id))
        .all();
      expect(notes).toHaveLength(2);
    });

    it('skips missions that already have intel notes', async () => {
      const mission = createTestMission(db, { battlefieldId: battlefield.id, title: 'Covered' });
      createTestIntelNote(db, { battlefieldId: battlefield.id, missionId: mission.id });

      const count = await backfillIntelNotes(battlefield.id);
      expect(count).toBe(0);
    });

    it('preserves campaign association from mission', async () => {
      const campaign = createTestCampaign(db, { battlefieldId: battlefield.id });
      createTestMission(db, {
        battlefieldId: battlefield.id,
        campaignId: campaign.id,
        title: 'Campaign Mission',
      });

      await backfillIntelNotes(battlefield.id);

      const notes = db
        .select()
        .from(intelNotes)
        .where(eq(intelNotes.battlefieldId, battlefield.id))
        .all();
      expect(notes).toHaveLength(1);
      expect(notes[0].campaignId).toBe(campaign.id);
      expect(notes[0].title).toBe('Campaign Mission');
    });

    it('returns 0 when no missions exist', async () => {
      const count = await backfillIntelNotes(battlefield.id);
      expect(count).toBe(0);
    });
  });
});
