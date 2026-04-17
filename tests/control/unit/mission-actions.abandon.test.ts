import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { getDatabase } from '@/lib/db';
import { missions, battlefields, comms } from '@/lib/db/schema';

// Mock the worktree module so we can assert the deleteBranch flag.
vi.mock('@/control/worktree', () => ({
  removeMissionWorktree: vi.fn(async () => {}),
  sanitizeBranchForPath: (branch: string) => branch.replace(/\//g, '-'),
}));

// Import after vi.mock so the mock is in place.
const { removeMissionWorktree } = await import('@/control/worktree');
const { abandonMission } = await import('@/actions/mission');

const BF_ID = 'bf-abandon-unit';
const db = getDatabase();

function seedBattlefield() {
  db.insert(battlefields)
    .values({
      id: BF_ID,
      name: 'ABANDON_UNIT',
      codename: 'ABANDON_UNIT',
      repoPath: '/tmp/fake-repo-abandon-unit',
      defaultBranch: 'main',
      needsGateManifest: 0,
      mainIsRed: 0,
      overrideMainRedGuard: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
}

function seedMission(id: string, opts: { worktreeBranch?: string } = {}) {
  db.insert(missions)
    .values({
      id,
      battlefieldId: BF_ID,
      title: 'test',
      briefing: 'do it',
      type: 'combat',
      status: 'queued',
      worktreeBranch: opts.worktreeBranch ?? null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as typeof missions.$inferInsert)
    .run();
}

describe('abandonMission worktree cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const mids = ['ab-unit-branch', 'ab-unit-no-branch'];
    db.delete(comms).where(inArray(comms.missionId, mids)).run();
    db.delete(missions).where(inArray(missions.id, mids)).run();
    db.delete(battlefields).where(eq(battlefields.id, BF_ID)).run();
    seedBattlefield();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls removeMissionWorktree with deleteBranch:true when mission has a worktreeBranch', async () => {
    seedMission('ab-unit-branch', { worktreeBranch: 'devroom/ab-unit-branch' });

    await abandonMission('ab-unit-branch');

    // Give the best-effort .catch() promise a tick to settle.
    await new Promise((r) => setImmediate(r));

    expect(removeMissionWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ deleteBranch: true }),
    );
  });

  it('does not call removeMissionWorktree when mission has no worktreeBranch', async () => {
    seedMission('ab-unit-no-branch');

    await abandonMission('ab-unit-no-branch');
    await new Promise((r) => setImmediate(r));

    expect(removeMissionWorktree).not.toHaveBeenCalled();
  });
});
