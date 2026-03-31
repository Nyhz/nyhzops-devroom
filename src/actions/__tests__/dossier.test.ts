import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getTestDb, closeTestDb } from '@/lib/test/db';
import { createTestDossier } from '@/lib/test/fixtures';
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
const { listDossiers, getDossier, createDossier, updateDossier, deleteDossier, resolveDossier } =
  await import('@/actions/dossier');

describe('dossier actions', () => {
  beforeEach(() => {
    const testDb = getTestDb();
    db = testDb.db;
    sqlite = testDb.sqlite;
  });

  afterEach(() => {
    closeTestDb(sqlite);
  });

  // ---------------------------------------------------------------------------
  // createDossier
  // ---------------------------------------------------------------------------
  describe('createDossier', () => {
    it('creates a dossier with all fields', async () => {
      const variables = [
        { key: 'target', label: 'Target', description: 'What', placeholder: 'e.g. auth' },
      ];
      const id = await createDossier({
        codename: 'recon',
        name: 'Recon Template',
        description: 'A recon dossier',
        briefingTemplate: 'Investigate {{target}}',
        variables,
        assetCodename: 'ALPHA',
      });

      expect(id).toBeDefined();
      const dossier = await getDossier(id);
      expect(dossier).toBeDefined();
      expect(dossier!.codename).toBe('RECON');
      expect(dossier!.name).toBe('Recon Template');
      expect(dossier!.description).toBe('A recon dossier');
      expect(dossier!.briefingTemplate).toBe('Investigate {{target}}');
      expect(JSON.parse(dossier!.variables!)).toEqual(variables);
      expect(dossier!.assetCodename).toBe('ALPHA');
    });

    it('uppercases and trims codename', async () => {
      const id = await createDossier({
        codename: '  sweep  ',
        name: 'Sweep',
        briefingTemplate: 'Sweep area',
      });
      const dossier = await getDossier(id);
      expect(dossier!.codename).toBe('SWEEP');
    });

    it('stores null for optional fields when omitted', async () => {
      const id = await createDossier({
        codename: 'MINIMAL',
        name: 'Minimal',
        briefingTemplate: 'Do the thing',
      });
      const dossier = await getDossier(id);
      expect(dossier!.description).toBeNull();
      expect(dossier!.variables).toBeNull();
      expect(dossier!.assetCodename).toBeNull();
    });

    it('throws on empty codename', async () => {
      await expect(
        createDossier({ codename: '  ', name: 'X', briefingTemplate: 'Y' }),
      ).rejects.toThrow('Codename is required');
    });

    it('throws on empty name', async () => {
      await expect(
        createDossier({ codename: 'X', name: '  ', briefingTemplate: 'Y' }),
      ).rejects.toThrow('Name is required');
    });

    it('throws on empty briefing template', async () => {
      await expect(
        createDossier({ codename: 'X', name: 'Y', briefingTemplate: '  ' }),
      ).rejects.toThrow('Briefing template is required');
    });

    it('throws on duplicate codename', async () => {
      await createDossier({ codename: 'DUP', name: 'First', briefingTemplate: 'A' });
      await expect(
        createDossier({ codename: 'dup', name: 'Second', briefingTemplate: 'B' }),
      ).rejects.toThrow('already exists');
    });
  });

  // ---------------------------------------------------------------------------
  // listDossiers
  // ---------------------------------------------------------------------------
  describe('listDossiers', () => {
    it('returns empty array when no dossiers exist', async () => {
      const result = await listDossiers();
      expect(result).toEqual([]);
    });

    it('returns dossiers ordered by codename ascending', async () => {
      createTestDossier(db, { codename: 'ZULU', name: 'Zulu' });
      createTestDossier(db, { codename: 'ALPHA', name: 'Alpha' });
      createTestDossier(db, { codename: 'MIKE', name: 'Mike' });

      const result = await listDossiers();
      expect(result).toHaveLength(3);
      expect(result[0].codename).toBe('ALPHA');
      expect(result[1].codename).toBe('MIKE');
      expect(result[2].codename).toBe('ZULU');
    });
  });

  // ---------------------------------------------------------------------------
  // getDossier
  // ---------------------------------------------------------------------------
  describe('getDossier', () => {
    it('returns a dossier by id', async () => {
      const created = createTestDossier(db, { codename: 'FETCH' });
      const result = await getDossier(created.id);
      expect(result).toBeDefined();
      expect(result!.codename).toBe('FETCH');
    });

    it('returns undefined for non-existent id', async () => {
      const result = await getDossier('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // updateDossier
  // ---------------------------------------------------------------------------
  describe('updateDossier', () => {
    it('updates codename', async () => {
      const created = createTestDossier(db, { codename: 'OLDNAME' });
      await updateDossier(created.id, { codename: 'newname' });

      const result = await getDossier(created.id);
      expect(result!.codename).toBe('NEWNAME');
    });

    it('updates name and description', async () => {
      const created = createTestDossier(db, { codename: 'UPDFIELDS' });
      await updateDossier(created.id, { name: 'New Name', description: 'New desc' });

      const result = await getDossier(created.id);
      expect(result!.name).toBe('New Name');
      expect(result!.description).toBe('New desc');
    });

    it('updates briefing template', async () => {
      const created = createTestDossier(db, { codename: 'UPDTPL' });
      await updateDossier(created.id, { briefingTemplate: 'New template {{var}}' });

      const result = await getDossier(created.id);
      expect(result!.briefingTemplate).toBe('New template {{var}}');
    });

    it('updates variables', async () => {
      const created = createTestDossier(db, { codename: 'UPDVARS' });
      const newVars = [{ key: 'x', label: 'X', description: 'X var', placeholder: 'x' }];
      await updateDossier(created.id, { variables: newVars });

      const result = await getDossier(created.id);
      expect(JSON.parse(result!.variables!)).toEqual(newVars);
    });

    it('updates assetCodename', async () => {
      const created = createTestDossier(db, { codename: 'UPDASSET' });
      await updateDossier(created.id, { assetCodename: 'BRAVO' });

      const result = await getDossier(created.id);
      expect(result!.assetCodename).toBe('BRAVO');
    });

    it('nulls description when set to empty string', async () => {
      const created = createTestDossier(db, { codename: 'NULLDESC', description: 'Something' });
      await updateDossier(created.id, { description: '' });

      const result = await getDossier(created.id);
      expect(result!.description).toBeNull();
    });

    it('throws on empty codename', async () => {
      const created = createTestDossier(db, { codename: 'EMPTYCD' });
      await expect(updateDossier(created.id, { codename: '  ' })).rejects.toThrow(
        'Codename is required',
      );
    });

    it('throws on empty name', async () => {
      const created = createTestDossier(db, { codename: 'EMPTYNM' });
      await expect(updateDossier(created.id, { name: '  ' })).rejects.toThrow('Name is required');
    });

    it('throws on empty briefing template', async () => {
      const created = createTestDossier(db, { codename: 'EMPTYTPL' });
      await expect(updateDossier(created.id, { briefingTemplate: '  ' })).rejects.toThrow(
        'Briefing template is required',
      );
    });

    it('throws on duplicate codename', async () => {
      createTestDossier(db, { codename: 'EXISTING' });
      const created = createTestDossier(db, { codename: 'CHANGE' });
      await expect(updateDossier(created.id, { codename: 'existing' })).rejects.toThrow(
        'already exists',
      );
    });

    it('allows updating codename to same value', async () => {
      const created = createTestDossier(db, { codename: 'SAME' });
      await updateDossier(created.id, { codename: 'same' });
      // Should not throw
    });

    it('throws for non-existent dossier', async () => {
      await expect(updateDossier('nonexistent', { name: 'x' })).rejects.toThrow('not found');
    });

    it('updates updatedAt timestamp', async () => {
      const created = createTestDossier(db, { codename: 'TIMESTAMP' });
      const originalUpdatedAt = created.updatedAt;

      // Small delay to ensure different timestamp
      await new Promise((r) => setTimeout(r, 5));
      await updateDossier(created.id, { name: 'Updated' });

      const result = await getDossier(created.id);
      expect(result!.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
    });
  });

  // ---------------------------------------------------------------------------
  // deleteDossier
  // ---------------------------------------------------------------------------
  describe('deleteDossier', () => {
    it('deletes a dossier', async () => {
      const created = createTestDossier(db, { codename: 'TODELETE' });
      await deleteDossier(created.id);

      const result = await getDossier(created.id);
      expect(result).toBeUndefined();
    });

    it('throws for non-existent dossier', async () => {
      await expect(deleteDossier('nonexistent')).rejects.toThrow('not found');
    });
  });

  // ---------------------------------------------------------------------------
  // resolveDossier
  // ---------------------------------------------------------------------------
  describe('resolveDossier', () => {
    it('resolves template variables', async () => {
      const created = createTestDossier(db, {
        codename: 'RESOLVE',
        briefingTemplate: 'Investigate {{target}} in {{area}} for {{purpose}}',
        assetCodename: 'ALPHA',
      });

      const result = await resolveDossier(created.id, {
        target: 'auth module',
        area: 'src/auth',
        purpose: 'security audit',
      });

      expect(result.briefing).toBe('Investigate auth module in src/auth for security audit');
      expect(result.assetCodename).toBe('ALPHA');
    });

    it('returns template as-is when no variables provided', async () => {
      const created = createTestDossier(db, {
        codename: 'NORESOLVE',
        briefingTemplate: 'Static briefing with no {{placeholders}}',
      });

      const result = await resolveDossier(created.id, {});
      expect(result.briefing).toBe('Static briefing with no {{placeholders}}');
    });

    it('replaces multiple occurrences of the same variable', async () => {
      const created = createTestDossier(db, {
        codename: 'MULTI',
        briefingTemplate: '{{name}} should check {{name}} config',
      });

      const result = await resolveDossier(created.id, { name: 'BRAVO' });
      expect(result.briefing).toBe('BRAVO should check BRAVO config');
    });

    it('leaves unreferenced placeholders intact', async () => {
      const created = createTestDossier(db, {
        codename: 'PARTIAL',
        briefingTemplate: '{{known}} and {{unknown}}',
      });

      const result = await resolveDossier(created.id, { known: 'resolved' });
      expect(result.briefing).toBe('resolved and {{unknown}}');
    });

    it('returns null assetCodename when not set', async () => {
      const created = createTestDossier(db, {
        codename: 'NOASSET',
        briefingTemplate: 'Simple',
        assetCodename: undefined,
      });

      const result = await resolveDossier(created.id, {});
      expect(result.assetCodename).toBeNull();
    });

    it('throws for non-existent dossier', async () => {
      await expect(resolveDossier('nonexistent', {})).rejects.toThrow('not found');
    });
  });
});
