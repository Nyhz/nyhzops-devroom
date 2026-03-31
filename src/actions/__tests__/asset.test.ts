import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getTestDb, closeTestDb } from '@/lib/test/db';
import { createTestBattlefield, createTestAsset, createTestMission } from '@/lib/test/fixtures';
import type Database from 'better-sqlite3';
import type { TestDB } from '@/lib/test/db';

let db: TestDB;
let sqlite: Database.Database;

// Mock db module to return test database
vi.mock('@/lib/db/index', async () => {
  const { eq } = await import('drizzle-orm');
  return {
    getDatabase: () => db,
    getOrThrow: (table: { id: unknown }, id: string, label: string) => {
      const row = db.select().from(table).where(eq(table.id, id)).get();
      if (!row) throw new Error(`${label}: ${id} not found`);
      return row;
    },
  };
});

// Import actions after mocking
const { getAssetDeployment, createAsset, updateAsset, toggleAssetStatus, deleteAsset } =
  await import('@/actions/asset');

describe('asset actions', () => {
  beforeEach(() => {
    const testDb = getTestDb();
    db = testDb.db;
    sqlite = testDb.sqlite;
  });

  afterEach(() => {
    closeTestDb(sqlite);
  });

  // ---------------------------------------------------------------------------
  // createAsset
  // ---------------------------------------------------------------------------
  describe('createAsset', () => {
    it('creates an asset with valid data', async () => {
      const id = await createAsset('Bravo', 'Reconnaissance', 'System prompt', 'claude-sonnet-4-6');
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');

      const { assets } = await import('@/lib/db/schema');
      const { eq } = await import('drizzle-orm');
      const row = db.select().from(assets).where(eq(assets.id, id)).get();
      expect(row).toBeDefined();
      expect(row!.codename).toBe('BRAVO');
      expect(row!.specialty).toBe('Reconnaissance');
      expect(row!.status).toBe('active');
      expect(row!.model).toBe('claude-sonnet-4-6');
    });

    it('uppercases and trims the codename', async () => {
      const id = await createAsset('  delta  ', 'Intel', '', 'claude-sonnet-4-6');
      const { assets } = await import('@/lib/db/schema');
      const { eq } = await import('drizzle-orm');
      const row = db.select().from(assets).where(eq(assets.id, id)).get();
      expect(row!.codename).toBe('DELTA');
    });

    it('stores null for empty systemPrompt', async () => {
      const id = await createAsset('Echo', 'Ops', '', 'claude-sonnet-4-6');
      const { assets } = await import('@/lib/db/schema');
      const { eq } = await import('drizzle-orm');
      const row = db.select().from(assets).where(eq(assets.id, id)).get();
      expect(row!.systemPrompt).toBeNull();
    });

    it('throws on empty codename', async () => {
      await expect(createAsset('  ', 'Ops', '', 'claude-sonnet-4-6')).rejects.toThrow(
        'Codename is required',
      );
    });

    it('throws on empty specialty', async () => {
      await expect(createAsset('Foxtrot', '  ', '', 'claude-sonnet-4-6')).rejects.toThrow(
        'Specialty is required',
      );
    });

    it('throws on invalid model', async () => {
      await expect(createAsset('Golf', 'Ops', '', 'gpt-4')).rejects.toThrow('Invalid model');
    });

    it('throws on duplicate codename', async () => {
      await createAsset('Hotel', 'Ops', '', 'claude-sonnet-4-6');
      await expect(createAsset('hotel', 'Intel', '', 'claude-sonnet-4-6')).rejects.toThrow(
        'already exists',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // updateAsset
  // ---------------------------------------------------------------------------
  describe('updateAsset', () => {
    it('updates codename', async () => {
      const asset = createTestAsset(db, { codename: 'INDIA' });
      await updateAsset(asset.id, { codename: 'juliet' });

      const { assets } = await import('@/lib/db/schema');
      const { eq } = await import('drizzle-orm');
      const row = db.select().from(assets).where(eq(assets.id, asset.id)).get();
      expect(row!.codename).toBe('JULIET');
    });

    it('updates specialty and systemPrompt', async () => {
      const asset = createTestAsset(db, { codename: 'KILO' });
      await updateAsset(asset.id, { specialty: 'Stealth', systemPrompt: 'Be quiet' });

      const { assets } = await import('@/lib/db/schema');
      const { eq } = await import('drizzle-orm');
      const row = db.select().from(assets).where(eq(assets.id, asset.id)).get();
      expect(row!.specialty).toBe('Stealth');
      expect(row!.systemPrompt).toBe('Be quiet');
    });

    it('updates model', async () => {
      const asset = createTestAsset(db, { codename: 'LIMA' });
      await updateAsset(asset.id, { model: 'claude-opus-4-6' });

      const { assets } = await import('@/lib/db/schema');
      const { eq } = await import('drizzle-orm');
      const row = db.select().from(assets).where(eq(assets.id, asset.id)).get();
      expect(row!.model).toBe('claude-opus-4-6');
    });

    it('throws on empty codename update', async () => {
      const asset = createTestAsset(db, { codename: 'MIKE' });
      await expect(updateAsset(asset.id, { codename: '  ' })).rejects.toThrow(
        'Codename is required',
      );
    });

    it('throws on duplicate codename update', async () => {
      createTestAsset(db, { codename: 'NOVEMBER' });
      const asset2 = createTestAsset(db, { codename: 'OSCAR' });
      await expect(updateAsset(asset2.id, { codename: 'november' })).rejects.toThrow(
        'already exists',
      );
    });

    it('allows updating codename to same value', async () => {
      const asset = createTestAsset(db, { codename: 'PAPA' });
      // Should not throw — codename unchanged
      await updateAsset(asset.id, { codename: 'papa' });
    });

    it('throws on invalid model update', async () => {
      const asset = createTestAsset(db, { codename: 'QUEBEC' });
      await expect(updateAsset(asset.id, { model: 'gpt-4' })).rejects.toThrow('Invalid model');
    });

    it('throws for non-existent asset', async () => {
      await expect(updateAsset('nonexistent', { specialty: 'x' })).rejects.toThrow('not found');
    });

    it('no-ops when no fields provided', async () => {
      const asset = createTestAsset(db, { codename: 'ROMEO' });
      // Should not throw
      await updateAsset(asset.id, {});
    });
  });

  // ---------------------------------------------------------------------------
  // toggleAssetStatus
  // ---------------------------------------------------------------------------
  describe('toggleAssetStatus', () => {
    it('toggles active to offline', async () => {
      const asset = createTestAsset(db, { codename: 'SIERRA', status: 'active' });
      await toggleAssetStatus(asset.id);

      const { assets } = await import('@/lib/db/schema');
      const { eq } = await import('drizzle-orm');
      const row = db.select().from(assets).where(eq(assets.id, asset.id)).get();
      expect(row!.status).toBe('offline');
    });

    it('toggles offline to active', async () => {
      const asset = createTestAsset(db, { codename: 'TANGO', status: 'offline' });
      await toggleAssetStatus(asset.id);

      const { assets } = await import('@/lib/db/schema');
      const { eq } = await import('drizzle-orm');
      const row = db.select().from(assets).where(eq(assets.id, asset.id)).get();
      expect(row!.status).toBe('active');
    });

    it('throws for non-existent asset', async () => {
      await expect(toggleAssetStatus('nonexistent')).rejects.toThrow('not found');
    });
  });

  // ---------------------------------------------------------------------------
  // deleteAsset
  // ---------------------------------------------------------------------------
  describe('deleteAsset', () => {
    it('deletes an asset with no mission references', async () => {
      const asset = createTestAsset(db, { codename: 'UNIFORM' });
      await deleteAsset(asset.id);

      const { assets } = await import('@/lib/db/schema');
      const { eq } = await import('drizzle-orm');
      const row = db.select().from(assets).where(eq(assets.id, asset.id)).get();
      expect(row).toBeUndefined();
    });

    it('sets asset to offline instead of deleting when missions reference it', async () => {
      const bf = createTestBattlefield(db);
      const asset = createTestAsset(db, { codename: 'VICTOR' });
      createTestMission(db, { battlefieldId: bf.id, assetId: asset.id });

      await deleteAsset(asset.id);

      const { assets } = await import('@/lib/db/schema');
      const { eq } = await import('drizzle-orm');
      const row = db.select().from(assets).where(eq(assets.id, asset.id)).get();
      expect(row).toBeDefined();
      expect(row!.status).toBe('offline');
    });

    it('throws for non-existent asset', async () => {
      await expect(deleteAsset('nonexistent')).rejects.toThrow('not found');
    });
  });

  // ---------------------------------------------------------------------------
  // getAssetDeployment
  // ---------------------------------------------------------------------------
  describe('getAssetDeployment', () => {
    it('returns empty when no assets exist', async () => {
      const result = await getAssetDeployment();
      expect(result.active).toEqual([]);
      expect(result.idle).toEqual([]);
    });

    it('returns idle assets with no active missions', async () => {
      createTestAsset(db, { codename: 'WHISKEY' });
      createTestAsset(db, { codename: 'XRAY' });

      const result = await getAssetDeployment();
      expect(result.active).toEqual([]);
      expect(result.idle).toContain('WHISKEY');
      expect(result.idle).toContain('XRAY');
    });

    it('returns active deployment entries for in-combat missions', async () => {
      const bf = createTestBattlefield(db);
      const asset = createTestAsset(db, { codename: 'YANKEE' });
      createTestMission(db, {
        battlefieldId: bf.id,
        assetId: asset.id,
        status: 'in_combat',
        title: 'Recon Op',
      });

      const result = await getAssetDeployment();
      expect(result.active).toHaveLength(1);
      expect(result.active[0].codename).toBe('YANKEE');
      expect(result.active[0].status).toBe('in_combat');
      expect(result.active[0].missionTitle).toBe('Recon Op');
      expect(result.idle).not.toContain('YANKEE');
    });

    it('returns queued status for queued missions', async () => {
      const bf = createTestBattlefield(db);
      const asset = createTestAsset(db, { codename: 'ZULU' });
      createTestMission(db, {
        battlefieldId: bf.id,
        assetId: asset.id,
        status: 'queued',
        title: 'Queued Op',
      });

      const result = await getAssetDeployment();
      expect(result.active).toHaveLength(1);
      expect(result.active[0].status).toBe('queued');
    });

    it('excludes offline assets from idle list', async () => {
      createTestAsset(db, { codename: 'OFFLINE_ASSET', status: 'offline' });

      const result = await getAssetDeployment();
      expect(result.idle).not.toContain('OFFLINE_ASSET');
    });
  });
});
