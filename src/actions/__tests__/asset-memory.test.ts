import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';
import { getTestDb, closeTestDb } from '@/lib/test/db';
import { createTestAsset } from '@/lib/test/fixtures';
import { createMockDbModule } from '@/lib/test/mock-db';
import type Database from 'better-sqlite3';
import type { TestDB } from '@/lib/test/db';

let db: TestDB;
let sqlite: Database.Database;

// Mock db module to return test database
vi.mock('@/lib/db/index', () => createMockDbModule(() => db));

// Import actions after mocking
const { getAssetMemory, updateAssetMemory } = await import('@/actions/asset');

describe('asset memory actions', () => {
  beforeEach(() => {
    const testDb = getTestDb();
    db = testDb.db;
    sqlite = testDb.sqlite;
  });

  afterEach(() => {
    closeTestDb(sqlite);
  });

  // -------------------------------------------------------------------------
  // getAssetMemory
  // -------------------------------------------------------------------------

  describe('getAssetMemory', () => {
    it('returns empty array when memory is null', async () => {
      const asset = createTestAsset(db, { codename: 'ALPHA', memory: null });
      const entries = await getAssetMemory(asset.id);
      expect(entries).toEqual([]);
    });

    it('returns empty array when memory is an empty string', async () => {
      const asset = createTestAsset(db, { codename: 'BRAVO', memory: '' });
      const entries = await getAssetMemory(asset.id);
      expect(entries).toEqual([]);
    });

    it('correctly parses a JSON array from memory', async () => {
      const stored = ['Always test edge cases.', 'Keep commits small.'];
      const asset = createTestAsset(db, { codename: 'CHARLIE', memory: JSON.stringify(stored) });
      const entries = await getAssetMemory(asset.id);
      expect(entries).toEqual(stored);
    });

    it('filters out non-string entries from memory array', async () => {
      // malformed — mixed types
      const asset = createTestAsset(db, {
        codename: 'DELTA',
        memory: JSON.stringify(['valid entry', 42, null, 'another valid']),
      });
      const entries = await getAssetMemory(asset.id);
      expect(entries).toEqual(['valid entry', 'another valid']);
    });

    it('returns empty array when memory contains malformed JSON', async () => {
      const asset = createTestAsset(db, { codename: 'ECHO', memory: 'not-valid-json{{{' });
      const entries = await getAssetMemory(asset.id);
      expect(entries).toEqual([]);
    });

    it('returns empty array when memory is a JSON object (not array)', async () => {
      const asset = createTestAsset(db, { codename: 'FOXTROT', memory: '{"key":"value"}' });
      const entries = await getAssetMemory(asset.id);
      expect(entries).toEqual([]);
    });

    it('throws when asset does not exist', async () => {
      await expect(getAssetMemory('nonexistent')).rejects.toThrow('not found');
    });
  });

  // -------------------------------------------------------------------------
  // updateAssetMemory — add
  // -------------------------------------------------------------------------

  describe('updateAssetMemory — add', () => {
    it('adds entries to empty memory', async () => {
      const asset = createTestAsset(db, { codename: 'GOLF', memory: null });
      const result = await updateAssetMemory(asset.id, { add: ['First lesson.'] });

      expect(result.entries).toEqual(['First lesson.']);
      expect(result.error).toBeUndefined();
    });

    it('appends entries to existing memory', async () => {
      const asset = createTestAsset(db, {
        codename: 'HOTEL',
        memory: JSON.stringify(['Existing lesson.']),
      });
      const result = await updateAssetMemory(asset.id, { add: ['New lesson.'] });

      expect(result.entries).toEqual(['Existing lesson.', 'New lesson.']);
    });

    it('adds multiple entries at once', async () => {
      const asset = createTestAsset(db, { codename: 'INDIA', memory: null });
      const result = await updateAssetMemory(asset.id, {
        add: ['Lesson one.', 'Lesson two.', 'Lesson three.'],
      });

      expect(result.entries).toHaveLength(3);
      expect(result.entries).toContain('Lesson one.');
      expect(result.entries).toContain('Lesson three.');
    });
  });

  // -------------------------------------------------------------------------
  // updateAssetMemory — remove
  // -------------------------------------------------------------------------

  describe('updateAssetMemory — remove', () => {
    it('removes entries by index', async () => {
      const asset = createTestAsset(db, {
        codename: 'JULIET',
        memory: JSON.stringify(['Keep A', 'Remove me', 'Keep B']),
      });
      const result = await updateAssetMemory(asset.id, { remove: [1] });

      expect(result.entries).toEqual(['Keep A', 'Keep B']);
    });

    it('removes multiple entries in one call', async () => {
      const asset = createTestAsset(db, {
        codename: 'KILO',
        memory: JSON.stringify(['Entry 0', 'Entry 1', 'Entry 2', 'Entry 3']),
      });
      const result = await updateAssetMemory(asset.id, { remove: [0, 2] });

      expect(result.entries).toEqual(['Entry 1', 'Entry 3']);
    });

    it('ignores out-of-bounds remove indices silently', async () => {
      const asset = createTestAsset(db, {
        codename: 'LIMA',
        memory: JSON.stringify(['Only entry']),
      });
      const result = await updateAssetMemory(asset.id, { remove: [5, 99] });

      expect(result.entries).toEqual(['Only entry']);
    });

    it('handles removing the last entry — leaves empty array', async () => {
      const asset = createTestAsset(db, {
        codename: 'MIKE',
        memory: JSON.stringify(['Solo entry']),
      });
      const result = await updateAssetMemory(asset.id, { remove: [0] });

      expect(result.entries).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // updateAssetMemory — replace
  // -------------------------------------------------------------------------

  describe('updateAssetMemory — replace', () => {
    it('replaces an entry by index', async () => {
      const asset = createTestAsset(db, {
        codename: 'NOVEMBER',
        memory: JSON.stringify(['Old lesson.', 'Keep this.']),
      });
      const result = await updateAssetMemory(asset.id, {
        replace: [{ index: 0, value: 'Updated lesson.' }],
      });

      expect(result.entries[0]).toBe('Updated lesson.');
      expect(result.entries[1]).toBe('Keep this.');
    });

    it('replaces multiple entries in one call', async () => {
      const asset = createTestAsset(db, {
        codename: 'OSCAR',
        memory: JSON.stringify(['Old A', 'Old B', 'Keep C']),
      });
      const result = await updateAssetMemory(asset.id, {
        replace: [
          { index: 0, value: 'New A' },
          { index: 1, value: 'New B' },
        ],
      });

      expect(result.entries).toEqual(['New A', 'New B', 'Keep C']);
    });

    it('ignores replace for out-of-bounds indices', async () => {
      const asset = createTestAsset(db, {
        codename: 'PAPA',
        memory: JSON.stringify(['Entry 0']),
      });
      const result = await updateAssetMemory(asset.id, {
        replace: [{ index: 99, value: 'Should not appear' }],
      });

      expect(result.entries).toEqual(['Entry 0']);
    });
  });

  // -------------------------------------------------------------------------
  // updateAssetMemory — combined operations
  // -------------------------------------------------------------------------

  describe('updateAssetMemory — combined operations', () => {
    it('applies remove then replace then add in order', async () => {
      // Start: ['Entry 0', 'Entry 1', 'Entry 2']
      // remove [1] → ['Entry 0', 'Entry 2']
      // replace [{ index: 1, value: 'Replaced 2' }] → ['Entry 0', 'Replaced 2']
      // add ['New'] → ['Entry 0', 'Replaced 2', 'New']
      const asset = createTestAsset(db, {
        codename: 'QUEBEC',
        memory: JSON.stringify(['Entry 0', 'Entry 1', 'Entry 2']),
      });
      const result = await updateAssetMemory(asset.id, {
        remove: [1],
        replace: [{ index: 1, value: 'Replaced 2' }],
        add: ['New'],
      });

      expect(result.entries).toEqual(['Entry 0', 'Replaced 2', 'New']);
    });
  });

  // -------------------------------------------------------------------------
  // updateAssetMemory — cap enforcement
  // -------------------------------------------------------------------------

  describe('updateAssetMemory — cap enforcement', () => {
    it('returns error and does not add when memory is at 15 entries', async () => {
      const fullMemory = Array.from({ length: 15 }, (_, i) => `Lesson ${i + 1}.`);
      const asset = createTestAsset(db, {
        codename: 'ROMEO',
        memory: JSON.stringify(fullMemory),
      });
      const result = await updateAssetMemory(asset.id, { add: ['One more lesson.'] });

      expect(result.error).toBe('Memory is at capacity (15 entries)');
      expect(result.entries).toHaveLength(15);
      // The new entry should not have been added
      expect(result.entries).not.toContain('One more lesson.');
    });

    it('fills remaining slots and stops at 15 when adding more than capacity allows', async () => {
      // 14 entries — 1 slot remaining
      const almostFull = Array.from({ length: 14 }, (_, i) => `Lesson ${i + 1}.`);
      const asset = createTestAsset(db, {
        codename: 'SIERRA',
        memory: JSON.stringify(almostFull),
      });
      // Try to add 3 but only 1 slot left
      const result = await updateAssetMemory(asset.id, {
        add: ['Added 1.', 'Added 2.', 'Added 3.'],
      });

      expect(result.entries).toHaveLength(15);
      expect(result.entries).toContain('Added 1.');
      expect(result.entries).not.toContain('Added 2.');
      expect(result.entries).not.toContain('Added 3.');
    });

    it('allows adding after removing entries that free up space', async () => {
      const fullMemory = Array.from({ length: 15 }, (_, i) => `Lesson ${i + 1}.`);
      const asset = createTestAsset(db, {
        codename: 'TANGO',
        memory: JSON.stringify(fullMemory),
      });
      // Remove 2 entries first, then add 2
      const result = await updateAssetMemory(asset.id, {
        remove: [0, 1],
        add: ['New lesson A.', 'New lesson B.'],
      });

      expect(result.entries).toHaveLength(15);
      expect(result.entries).toContain('New lesson A.');
      expect(result.entries).toContain('New lesson B.');
      expect(result.error).toBeUndefined();
    });

    it('throws when asset does not exist', async () => {
      await expect(updateAssetMemory('nonexistent', { add: ['x'] })).rejects.toThrow('not found');
    });
  });

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  describe('persistence', () => {
    it('persists updates to the database so getAssetMemory reflects them', async () => {
      const asset = createTestAsset(db, { codename: 'UNIFORM', memory: null });
      await updateAssetMemory(asset.id, { add: ['Persisted lesson.'] });

      const fetched = await getAssetMemory(asset.id);
      expect(fetched).toEqual(['Persisted lesson.']);
    });
  });
});
