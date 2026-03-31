import { ulid } from 'ulid';
import type { DB } from '@/lib/db/index';
import { battlefields, missions, campaigns, phases, assets } from '@/lib/db/schema';

export function createTestBattlefield(
  db: DB,
  overrides?: Partial<typeof battlefields.$inferInsert>,
) {
  const now = Date.now();
  const id = ulid();
  return db
    .insert(battlefields)
    .values({
      id,
      name: `Test Battlefield ${id.slice(-4)}`,
      codename: `TESTFIELD-${id.slice(-4)}`,
      repoPath: `/tmp/test-repo-${id.slice(-4)}`,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .returning()
    .get();
}

export function createTestMission(
  db: DB,
  opts: { battlefieldId: string } & Partial<typeof missions.$inferInsert>,
) {
  const now = Date.now();
  const id = ulid();
  const { battlefieldId, ...overrides } = opts;
  return db
    .insert(missions)
    .values({
      id,
      battlefieldId,
      title: `Test Mission ${id.slice(-4)}`,
      briefing: 'Test mission briefing content',
      status: 'standby',
      priority: 'normal',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .returning()
    .get();
}

export function createTestCampaign(
  db: DB,
  opts: { battlefieldId: string } & Partial<typeof campaigns.$inferInsert>,
) {
  const now = Date.now();
  const id = ulid();
  const { battlefieldId, ...overrides } = opts;
  return db
    .insert(campaigns)
    .values({
      id,
      battlefieldId,
      name: `Test Campaign ${id.slice(-4)}`,
      objective: 'Test campaign objective',
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .returning()
    .get();
}

export function createTestPhase(
  db: DB,
  opts: { campaignId: string } & Partial<typeof phases.$inferInsert>,
) {
  const now = Date.now();
  const id = ulid();
  const { campaignId, ...overrides } = opts;
  return db
    .insert(phases)
    .values({
      id,
      campaignId,
      phaseNumber: 1,
      name: `Test Phase ${id.slice(-4)}`,
      status: 'standby',
      createdAt: now,
      ...overrides,
    })
    .returning()
    .get();
}

export function createTestAsset(
  db: DB,
  overrides?: Partial<typeof assets.$inferInsert>,
) {
  const now = Date.now();
  const id = ulid();
  return db
    .insert(assets)
    .values({
      id,
      codename: `AGENT-${id.slice(-4)}`,
      specialty: 'testing',
      status: 'active',
      createdAt: now,
      ...overrides,
    })
    .returning()
    .get();
}
