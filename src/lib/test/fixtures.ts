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
  notifications,
  captainLogs,
  briefingSessions,
  briefingMessages,
  generalSessions,
  generalMessages,
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
      name: `Test Campaign ${id.slice(-4)}`,
      objective: 'Test campaign objective',
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
      name: `Test Phase ${id.slice(-4)}`,
      status: 'standby',
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
      codename: `AGENT-${id.slice(-4)}`,
      specialty: 'testing',
      status: 'active',
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

export function createTestNotification(
  db: TestDB,
  overrides: Partial<typeof notifications.$inferInsert> = {},
) {
  const id = overrides.id ?? ulid();
  const record = db
    .insert(notifications)
    .values({
      id,
      level: 'info',
      title: 'Test Notification',
      detail: 'Test detail',
      read: 0,
      createdAt: now,
      ...overrides,
    })
    .returning()
    .get();
  return record;
}

export function createTestCaptainLog(
  db: TestDB,
  params: { missionId: string; battlefieldId: string } & Partial<typeof captainLogs.$inferInsert>,
) {
  const { missionId, battlefieldId, ...overrides } = params;
  const id = overrides.id ?? ulid();
  const record = db
    .insert(captainLogs)
    .values({
      id,
      missionId,
      battlefieldId,
      question: 'Should we proceed?',
      answer: 'Yes',
      reasoning: 'All clear',
      confidence: 'high',
      escalated: 0,
      timestamp: now,
      ...overrides,
    })
    .returning()
    .get();
  return record;
}

export function createTestBriefingSession(
  db: TestDB,
  params: { campaignId: string } & Partial<typeof briefingSessions.$inferInsert>,
) {
  const { campaignId, ...overrides } = params;
  const id = overrides.id ?? ulid();
  const record = db
    .insert(briefingSessions)
    .values({
      id,
      campaignId,
      status: 'open',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .returning()
    .get();
  return record;
}

export function createTestBriefingMessage(
  db: TestDB,
  params: { briefingId: string } & Partial<typeof briefingMessages.$inferInsert>,
) {
  const { briefingId, ...overrides } = params;
  const id = overrides.id ?? ulid();
  const record = db
    .insert(briefingMessages)
    .values({
      id,
      briefingId,
      role: 'commander',
      content: 'Test message',
      timestamp: now,
      ...overrides,
    })
    .returning()
    .get();
  return record;
}

export function createTestGeneralSession(
  db: TestDB,
  overrides: Partial<typeof generalSessions.$inferInsert> = {},
) {
  const id = overrides.id ?? ulid();
  const record = db
    .insert(generalSessions)
    .values({
      id,
      name: 'Test Session',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .returning()
    .get();
  return record;
}

export function createTestGeneralMessage(
  db: TestDB,
  params: { sessionId: string } & Partial<typeof generalMessages.$inferInsert>,
) {
  const { sessionId, ...overrides } = params;
  const id = overrides.id ?? ulid();
  const record = db
    .insert(generalMessages)
    .values({
      id,
      sessionId,
      role: 'commander',
      content: 'Test message',
      timestamp: now,
      ...overrides,
    })
    .returning()
    .get();
  return record;
}
