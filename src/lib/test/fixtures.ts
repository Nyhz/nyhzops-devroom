import { ulid } from 'ulid';
import { battlefields, missions, campaigns, phases, assets } from '@/lib/db/schema';
import type { DB } from '@/lib/db/index';

export function createTestBattlefield(
  db: DB,
  overrides: Partial<typeof battlefields.$inferInsert> = {},
) {
  const now = Date.now();
  const id = overrides.id ?? ulid();
  const values = {
    id,
    name: `Test Battlefield ${id.slice(-4)}`,
    codename: `CODENAME-${id.slice(-4)}`,
    repoPath: `/tmp/test-repo-${id.slice(-4)}`,
    defaultBranch: 'main',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  return db.insert(battlefields).values(values).returning().get();
}

export function createTestMission(
  db: DB,
  overrides: Partial<typeof missions.$inferInsert> & { battlefieldId: string },
) {
  const now = Date.now();
  const id = overrides.id ?? ulid();
  const values = {
    id,
    title: `Test Mission ${id.slice(-4)}`,
    briefing: 'Test briefing content',
    status: 'standby',
    priority: 'normal',
    type: 'standard',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  return db.insert(missions).values(values).returning().get();
}

export function createTestCampaign(
  db: DB,
  overrides: Partial<typeof campaigns.$inferInsert> & { battlefieldId: string },
) {
  const now = Date.now();
  const id = overrides.id ?? ulid();
  const values = {
    id,
    name: `Test Campaign ${id.slice(-4)}`,
    objective: 'Test objective',
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  return db.insert(campaigns).values(values).returning().get();
}

export function createTestPhase(
  db: DB,
  overrides: Partial<typeof phases.$inferInsert> & { campaignId: string },
) {
  const now = Date.now();
  const id = overrides.id ?? ulid();
  const values = {
    id,
    phaseNumber: 1,
    name: `Test Phase ${id.slice(-4)}`,
    status: 'standby',
    createdAt: now,
    ...overrides,
  };
  return db.insert(phases).values(values).returning().get();
}

export function createTestAsset(
  db: DB,
  overrides: Partial<typeof assets.$inferInsert> = {},
) {
  const now = Date.now();
  const id = overrides.id ?? ulid();
  const values = {
    id,
    codename: overrides.codename ?? `ASSET-${id.slice(-4)}`,
    specialty: 'testing',
    status: 'active',
    createdAt: now,
    ...overrides,
  };
  return db.insert(assets).values(values).returning().get();
}
