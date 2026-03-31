import { generateId } from '@/lib/utils';
import { assets, battlefields, missions, campaigns, phases, dossiers } from '@/lib/db/schema';
import type { DB } from '@/lib/db/index';

export function createTestBattlefield(db: DB, overrides: Partial<typeof battlefields.$inferInsert> = {}) {
  const now = Date.now();
  const values = {
    id: generateId(),
    name: 'Test Battlefield',
    codename: 'TEST-BF',
    repoPath: '/tmp/test-repo',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  db.insert(battlefields).values(values).run();
  return values;
}

export function createTestAsset(db: DB, overrides: Partial<typeof assets.$inferInsert> = {}) {
  const values = {
    id: generateId(),
    codename: 'ALPHA',
    specialty: 'Testing',
    systemPrompt: 'You are a test asset',
    model: 'claude-sonnet-4-6',
    status: 'active' as const,
    missionsCompleted: 0,
    createdAt: Date.now(),
    ...overrides,
  };
  db.insert(assets).values(values).run();
  return values;
}

export function createTestMission(db: DB, opts: { battlefieldId: string } & Partial<typeof missions.$inferInsert>) {
  const now = Date.now();
  const values = {
    id: generateId(),
    title: 'Test Mission',
    briefing: 'Test briefing',
    status: 'standby',
    createdAt: now,
    updatedAt: now,
    ...opts,
  };
  db.insert(missions).values(values).run();
  return values;
}

export function createTestCampaign(db: DB, opts: { battlefieldId: string } & Partial<typeof campaigns.$inferInsert>) {
  const now = Date.now();
  const values = {
    id: generateId(),
    name: 'Test Campaign',
    objective: 'Test objective',
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    ...opts,
  };
  db.insert(campaigns).values(values).run();
  return values;
}

export function createTestPhase(db: DB, opts: { campaignId: string } & Partial<typeof phases.$inferInsert>) {
  const values = {
    id: generateId(),
    phaseNumber: 1,
    name: 'Test Phase',
    status: 'standby',
    createdAt: Date.now(),
    ...opts,
  };
  db.insert(phases).values(values).run();
  return values;
}

export function createTestDossier(db: DB, overrides: Partial<typeof dossiers.$inferInsert> = {}) {
  const now = Date.now();
  const values = {
    id: generateId(),
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
  };
  db.insert(dossiers).values(values).run();
  return values;
}
