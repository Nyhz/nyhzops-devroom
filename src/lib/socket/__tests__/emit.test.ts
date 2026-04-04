import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getTestDb, closeTestDb } from '@/lib/test/db';
import {
  createTestBattlefield,
  createTestCampaign,
  createTestPhase,
  createTestMission,
} from '@/lib/test/fixtures';
import { createMockDbModule } from '@/lib/test/mock-db';
import type Database from 'better-sqlite3';
import type { DB } from '@/lib/db/index';

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------
let testDb: DB;
let testSqlite: Database.Database;

vi.mock('@/lib/db/index', () => createMockDbModule(() => testDb));

// next/cache is mocked globally in setup.ts — import to get the mock reference
import { revalidatePath } from 'next/cache';

// Import the module under test AFTER mocks are set up
const { emitStatusChange } = await import('@/lib/socket/emit');

// ---------------------------------------------------------------------------
// Helpers — capture emit calls via globalThis.io (set up by setup.ts)
// ---------------------------------------------------------------------------
function getRooms(): string[] {
  const io = globalThis.io!;
  const mockTo = io.to as ReturnType<typeof vi.fn>;
  return mockTo.mock.calls.map((call: unknown[]) => call[0] as string);
}

function getEmitCalls(): Array<[string, Record<string, unknown>]> {
  const io = globalThis.io!;
  const mockTo = io.to as ReturnType<typeof vi.fn>;
  // Each `to(room)` returns `{ emit }`. We read the emit fn from the returned value.
  // setup.ts wires: mockTo = vi.fn(() => ({ emit: mockEmit }))
  // So we inspect the shared mockEmit that came from setup.ts.
  const mockEmit = (mockTo.mock.results[0]?.value as { emit: ReturnType<typeof vi.fn> } | undefined)?.emit;
  if (!mockEmit) return [];
  return mockEmit.mock.calls as Array<[string, Record<string, unknown>]>;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe('emitStatusChange', () => {
  beforeEach(() => {
    const t = getTestDb();
    testDb = t.db;
    testSqlite = t.sqlite;
    vi.clearAllMocks();
  });

  afterEach(() => {
    closeTestDb(testSqlite);
  });

  // =========================================================================
  // Mission — no campaign
  // =========================================================================
  it('emits mission status to mission, battlefield, and hq rooms', () => {
    const bf = createTestBattlefield(testDb);
    const mission = createTestMission(testDb, { battlefieldId: bf.id });

    emitStatusChange('mission', mission.id, 'IN COMBAT');

    const rooms = getRooms();
    expect(rooms).toContain(`mission:${mission.id}`);
    expect(rooms).toContain(`battlefield:${bf.id}`);
    expect(rooms).toContain('hq:activity');
  });

  it('does not emit to campaign room when mission has no campaignId', () => {
    const bf = createTestBattlefield(testDb);
    const mission = createTestMission(testDb, { battlefieldId: bf.id });

    emitStatusChange('mission', mission.id, 'ACCOMPLISHED');

    const rooms = getRooms();
    const campaignRooms = rooms.filter((r) => r.startsWith('campaign:'));
    expect(campaignRooms).toHaveLength(0);
  });

  // =========================================================================
  // Mission — with campaign
  // =========================================================================
  it('emits to campaign room when mission has a campaignId', () => {
    const bf = createTestBattlefield(testDb);
    const campaign = createTestCampaign(testDb, { battlefieldId: bf.id });
    const phase = createTestPhase(testDb, { campaignId: campaign.id });
    const mission = createTestMission(testDb, {
      battlefieldId: bf.id,
      campaignId: campaign.id,
      phaseId: phase.id,
    });

    emitStatusChange('mission', mission.id, 'IN COMBAT');

    const rooms = getRooms();
    expect(rooms).toContain(`mission:${mission.id}`);
    expect(rooms).toContain(`battlefield:${bf.id}`);
    expect(rooms).toContain(`campaign:${campaign.id}`);
    expect(rooms).toContain('hq:activity');
  });

  // =========================================================================
  // revalidatePath is called before emitting
  // =========================================================================
  it('calls revalidatePath before emitting for a mission', () => {
    const bf = createTestBattlefield(testDb);
    const mission = createTestMission(testDb, { battlefieldId: bf.id });

    const revalidateMock = vi.mocked(revalidatePath);
    const callOrder: string[] = [];
    revalidateMock.mockImplementation(() => {
      callOrder.push('revalidate');
    });

    const io = globalThis.io!;
    const mockTo = io.to as ReturnType<typeof vi.fn>;
    mockTo.mockImplementation((room: string) => {
      callOrder.push(`emit:${room}`);
      return { emit: vi.fn() };
    });

    emitStatusChange('mission', mission.id, 'ACCOMPLISHED');

    const revalidateIndex = callOrder.indexOf('revalidate');
    const firstEmitIndex = callOrder.findIndex((s) => s.startsWith('emit:'));
    expect(revalidateIndex).toBeGreaterThanOrEqual(0);
    expect(firstEmitIndex).toBeGreaterThan(revalidateIndex);
  });

  // =========================================================================
  // Campaign entity
  // =========================================================================
  it('emits campaign status to campaign, battlefield, and hq rooms', () => {
    const bf = createTestBattlefield(testDb);
    const campaign = createTestCampaign(testDb, { battlefieldId: bf.id });

    emitStatusChange('campaign', campaign.id, 'ACTIVE');

    const rooms = getRooms();
    expect(rooms).toContain(`campaign:${campaign.id}`);
    expect(rooms).toContain(`battlefield:${bf.id}`);
    expect(rooms).toContain('hq:activity');
  });

  // =========================================================================
  // Phase entity
  // =========================================================================
  it('emits phase status to campaign, battlefield, and hq rooms', () => {
    const bf = createTestBattlefield(testDb);
    const campaign = createTestCampaign(testDb, { battlefieldId: bf.id });
    const phase = createTestPhase(testDb, { campaignId: campaign.id });

    emitStatusChange('phase', phase.id, 'SECURED');

    const rooms = getRooms();
    expect(rooms).toContain(`campaign:${campaign.id}`);
    expect(rooms).toContain(`battlefield:${bf.id}`);
    expect(rooms).toContain('hq:activity');
  });

  // =========================================================================
  // Battlefield entity
  // =========================================================================
  it('emits battlefield status to battlefield and hq rooms', () => {
    const bf = createTestBattlefield(testDb);

    emitStatusChange('battlefield', bf.id, 'ACTIVE');

    const rooms = getRooms();
    expect(rooms).toContain(`battlefield:${bf.id}`);
    expect(rooms).toContain('hq:activity');
  });

  // =========================================================================
  // Extra data passes through to payload
  // =========================================================================
  it('passes extra data through to the emitted payload', () => {
    const bf = createTestBattlefield(testDb);
    const campaign = createTestCampaign(testDb, { battlefieldId: bf.id });

    // Use a fresh mockEmit to capture payloads
    const emitted: Array<[string, Record<string, unknown>]> = [];
    const io = globalThis.io!;
    const mockTo = io.to as ReturnType<typeof vi.fn>;
    mockTo.mockImplementation(() => ({
      emit: (event: string, payload: Record<string, unknown>) => {
        emitted.push([event, payload]);
      },
    }));

    emitStatusChange('campaign', campaign.id, 'ACCOMPLISHED', { debrief: 'All clear' });

    expect(emitted.length).toBeGreaterThan(0);
    for (const [, payload] of emitted) {
      expect(payload).toMatchObject({ status: 'ACCOMPLISHED', debrief: 'All clear' });
      expect(payload.timestamp).toBeDefined();
    }
  });

  // =========================================================================
  // No throw when io is undefined
  // =========================================================================
  it('does not throw when globalThis.io is undefined', () => {
    const bf = createTestBattlefield(testDb);
    const savedIo = globalThis.io;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).io = undefined;

    try {
      expect(() => emitStatusChange('battlefield', bf.id, 'ACTIVE')).not.toThrow();
    } finally {
      globalThis.io = savedIo;
    }
  });

  // =========================================================================
  // Missing entity — no throw
  // =========================================================================
  it('does not throw when entity id does not exist', () => {
    expect(() =>
      emitStatusChange('mission', 'NONEXISTENT', 'ABANDONED'),
    ).not.toThrow();
  });
});
