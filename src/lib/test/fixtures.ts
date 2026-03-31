import { generateId } from '@/lib/utils';
import {
  battlefields,
  campaigns,
  phases,
  missions,
  assets,
} from '@/lib/db/schema';
import type { DB } from '@/lib/db/index';

export function createTestBattlefield(
  db: DB,
  overrides: Partial<typeof battlefields.$inferInsert> = {},
) {
  const now = Date.now();
  const values = {
    id: generateId(),
    name: 'Test Battlefield',
    codename: 'TESTFIELD',
    repoPath: '/tmp/test-repo',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  db.insert(battlefields).values(values).run();
  return values;
}

export function createTestCampaign(
  db: DB,
  overrides: Partial<typeof campaigns.$inferInsert> & { battlefieldId: string },
) {
  const now = Date.now();
  const values = {
    id: generateId(),
    name: 'Test Campaign',
    objective: 'Test objective',
    status: 'draft' as const,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  db.insert(campaigns).values(values).run();
  return values;
}

export function createTestPhase(
  db: DB,
  overrides: Partial<typeof phases.$inferInsert> & { campaignId: string },
) {
  const now = Date.now();
  const values = {
    id: generateId(),
    phaseNumber: 1,
    name: 'Test Phase',
    objective: 'Test phase objective',
    status: 'standby' as const,
    createdAt: now,
    ...overrides,
  };
  db.insert(phases).values(values).run();
  return values;
}

export function createTestMission(
  db: DB,
  overrides: Partial<typeof missions.$inferInsert> & { battlefieldId: string },
) {
  const now = Date.now();
  const values = {
    id: generateId(),
    title: 'Test Mission',
    briefing: 'Test briefing content',
    status: 'standby' as const,
    priority: 'normal' as const,
    type: 'standard' as const,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  db.insert(missions).values(values).run();
  return values;
}

export function createTestAsset(
  db: DB,
  overrides: Partial<typeof assets.$inferInsert> = {},
) {
  const now = Date.now();
  const values = {
    id: generateId(),
    codename: 'TESTER',
    specialty: 'Testing',
    status: 'active' as const,
    createdAt: now,
    ...overrides,
  };
  db.insert(assets).values(values).run();
  return values;
}
