import { ulid } from 'ulid';
import type { TestDB } from './db';
import {
  battlefields,
  missions,
  campaigns,
  phases,
  assets,
  dossiers,
  intelNotes,
  followUpSuggestions,
} from '@/lib/db/schema';

const now = Date.now();

export function createTestBattlefield(
  db: TestDB,
  overrides: Partial<typeof battlefields.$inferInsert> = {},
) {
  const id = overrides.id ?? ulid();
  const record = db
    .insert(battlefields)
    .values({
      id,
      name: 'Test Battlefield',
      codename: 'TESTFIELD',
      repoPath: '/tmp/test-repo',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .returning()
    .get();
  return record;
}

export function createTestMission(
  db: TestDB,
  params: { battlefieldId: string } & Partial<typeof missions.$inferInsert>,
) {
  const { battlefieldId, ...overrides } = params;
  const id = overrides.id ?? ulid();
  const record = db
    .insert(missions)
    .values({
      id,
      battlefieldId,
      title: 'Test Mission',
      briefing: 'Test briefing content',
      status: 'standby',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .returning()
    .get();
  return record;
}

export function createTestCampaign(
  db: TestDB,
  params: { battlefieldId: string } & Partial<typeof campaigns.$inferInsert>,
) {
  const { battlefieldId, ...overrides } = params;
  const id = overrides.id ?? ulid();
  const record = db
    .insert(campaigns)
    .values({
      id,
      battlefieldId,
      name: 'Test Campaign',
      objective: 'Test objective',
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .returning()
    .get();
  return record;
}

export function createTestPhase(
  db: TestDB,
  params: { campaignId: string } & Partial<typeof phases.$inferInsert>,
) {
  const { campaignId, ...overrides } = params;
  const id = overrides.id ?? ulid();
  const record = db
    .insert(phases)
    .values({
      id,
      campaignId,
      phaseNumber: 1,
      name: 'Test Phase',
      createdAt: now,
      ...overrides,
    })
    .returning()
    .get();
  return record;
}

export function createTestAsset(
  db: TestDB,
  overrides: Partial<typeof assets.$inferInsert> = {},
) {
  const id = overrides.id ?? ulid();
  const record = db
    .insert(assets)
    .values({
      id,
      codename: `ASSET-${id.slice(-4)}`,
      specialty: 'testing',
      createdAt: now,
      ...overrides,
    })
    .returning()
    .get();
  return record;
}

export function createTestDossier(
  db: TestDB,
  overrides: Partial<typeof dossiers.$inferInsert> = {},
) {
  const id = overrides.id ?? ulid();
  const record = db
    .insert(dossiers)
    .values({
      id,
      codename: 'RECON',
      name: 'Recon Dossier',
      briefingTemplate: 'Investigate {{target}} in {{area}}',
      variables: JSON.stringify([
        { key: 'target', label: 'Target', description: 'What to investigate', placeholder: 'e.g. auth module' },
        { key: 'area', label: 'Area', description: 'Where to look', placeholder: 'e.g. src/auth' },
      ]),
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .returning()
    .get();
  return record;
}

export function createTestIntelNote(
  db: TestDB,
  params: { battlefieldId: string } & Partial<typeof intelNotes.$inferInsert>,
) {
  const { battlefieldId, ...overrides } = params;
  const id = overrides.id ?? ulid();
  const record = db
    .insert(intelNotes)
    .values({
      id,
      battlefieldId,
      title: 'Test Note',
      column: 'backlog',
      position: 0,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .returning()
    .get();
  return record;
}

export function createTestFollowUpSuggestion(
  db: TestDB,
  params: { battlefieldId: string } & Partial<typeof followUpSuggestions.$inferInsert>,
) {
  const { battlefieldId, ...overrides } = params;
  const id = overrides.id ?? ulid();
  const record = db
    .insert(followUpSuggestions)
    .values({
      id,
      battlefieldId,
      suggestion: 'Test suggestion',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .returning()
    .get();
  return record;
}
