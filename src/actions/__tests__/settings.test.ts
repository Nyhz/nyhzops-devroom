import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getTestDb, closeTestDb, type TestDB } from '@/lib/test/db';
import { createMockDbModule } from '@/lib/test/mock-db';
import { settings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type Database from 'better-sqlite3';

let db: TestDB;
let sqlite: Database.Database;

// Mock the DB module to inject test database
vi.mock('@/lib/db/index', () => createMockDbModule(() => db));

// Mock next/cache — revalidatePath is a no-op in tests
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// Import actions AFTER mocks are set up
import {
  getRulesOfEngagementAction,
  updateRulesOfEngagementAction,
} from '@/actions/settings';

describe('settings actions — rules of engagement', () => {
  beforeEach(() => {
    const testDb = getTestDb();
    db = testDb.db;
    sqlite = testDb.sqlite;
    // Ensure clean state — table is empty on each fresh in-memory DB
    db.delete(settings).where(eq(settings.key, 'rules_of_engagement')).run();
  });

  afterEach(() => {
    closeTestDb(sqlite);
  });

  it('getRulesOfEngagementAction returns empty string when unset', async () => {
    const result = await getRulesOfEngagementAction();
    expect(result.value).toBe('');
    expect(result.updatedAt).toBeNull();
  });

  it('updateRulesOfEngagementAction writes a value', async () => {
    await updateRulesOfEngagementAction('new rules text');
    const result = await getRulesOfEngagementAction();
    expect(result.value).toBe('new rules text');
    expect(result.updatedAt).toBeGreaterThan(0);
  });

  it('updateRulesOfEngagementAction overwrites an existing value', async () => {
    await updateRulesOfEngagementAction('first');
    await updateRulesOfEngagementAction('second');
    const result = await getRulesOfEngagementAction();
    expect(result.value).toBe('second');
  });

  it('updateRulesOfEngagementAction rejects empty strings', async () => {
    await expect(updateRulesOfEngagementAction('')).rejects.toThrow(/empty/i);
  });
});
