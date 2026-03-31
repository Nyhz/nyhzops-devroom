import { generateId } from '@/lib/utils';
import {
  assets, battlefields, missions, campaigns, phases, dossiers,
  notifications, captainLogs, briefingSessions, briefingMessages,
  generalSessions, generalMessages,
} from '@/lib/db/schema';
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

export function createTestNotification(db: DB, overrides: Partial<typeof notifications.$inferInsert> = {}) {
  const values = {
    id: generateId(),
    level: 'info',
    title: 'Test Notification',
    detail: 'Test detail',
    read: 0,
    createdAt: Date.now(),
    ...overrides,
  };
  db.insert(notifications).values(values).run();
  return values;
}

export function createTestCaptainLog(
  db: DB,
  opts: { missionId: string; battlefieldId: string } & Partial<typeof captainLogs.$inferInsert>,
) {
  const values = {
    id: generateId(),
    question: 'Should we proceed?',
    answer: 'Yes',
    reasoning: 'All clear',
    confidence: 'high',
    escalated: 0,
    timestamp: Date.now(),
    ...opts,
  };
  db.insert(captainLogs).values(values).run();
  return values;
}

export function createTestBriefingSession(
  db: DB,
  opts: { campaignId: string } & Partial<typeof briefingSessions.$inferInsert>,
) {
  const now = Date.now();
  const values = {
    id: generateId(),
    status: 'open',
    createdAt: now,
    updatedAt: now,
    ...opts,
  };
  db.insert(briefingSessions).values(values).run();
  return values;
}

export function createTestBriefingMessage(
  db: DB,
  opts: { briefingId: string } & Partial<typeof briefingMessages.$inferInsert>,
) {
  const values = {
    id: generateId(),
    role: 'commander',
    content: 'Test message',
    timestamp: Date.now(),
    ...opts,
  };
  db.insert(briefingMessages).values(values).run();
  return values;
}

export function createTestGeneralSession(db: DB, overrides: Partial<typeof generalSessions.$inferInsert> = {}) {
  const now = Date.now();
  const values = {
    id: generateId(),
    name: 'Test Session',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  db.insert(generalSessions).values(values).run();
  return values;
}

export function createTestGeneralMessage(
  db: DB,
  opts: { sessionId: string } & Partial<typeof generalMessages.$inferInsert>,
) {
  const values = {
    id: generateId(),
    role: 'commander',
    content: 'Test message',
    timestamp: Date.now(),
    ...opts,
  };
  db.insert(generalMessages).values(values).run();
  return values;
}
