import { describe, it, expect, beforeEach } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

import { getDatabase } from '@/lib/db';
import {
  battlefields,
  campaigns,
  phases,
  missions,
  comms,
  missionAttempts,
} from '@/lib/db/schema';
import {
  launchCampaign,
  onMissionTerminal,
  onMissionCompromisedAwaitingCommander,
  tacticalOverride,
  abandonMission,
  acceptAndMerge,
} from '@/control/campaign/executor';

const BF_ID = 'bf-campaign-executor';
const db = getDatabase();

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

function cleanDb(): void {
  const campaignIds = db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.battlefieldId, BF_ID))
    .all()
    .map((c) => c.id);
  const phaseIds = db
    .select({ id: phases.id })
    .from(phases)
    .where(campaignIds.length ? inArray(phases.campaignId, campaignIds) : eq(phases.id, '__none__'))
    .all()
    .map((p) => p.id);
  const missionIds = db
    .select({ id: missions.id })
    .from(missions)
    .where(eq(missions.battlefieldId, BF_ID))
    .all()
    .map((m) => m.id);

  if (missionIds.length) {
    db.delete(comms).where(inArray(comms.missionId, missionIds)).run();
    db.delete(missionAttempts).where(inArray(missionAttempts.missionId, missionIds)).run();
    db.delete(missions).where(inArray(missions.id, missionIds)).run();
  }
  if (campaignIds.length) {
    db.delete(comms).where(inArray(comms.campaignId, campaignIds)).run();
  }
  if (phaseIds.length) {
    db.delete(phases).where(inArray(phases.id, phaseIds)).run();
  }
  if (campaignIds.length) {
    db.delete(campaigns).where(inArray(campaigns.id, campaignIds)).run();
  }
  db.delete(battlefields).where(eq(battlefields.id, BF_ID)).run();
}

function seedBattlefield(): void {
  db.insert(battlefields)
    .values({
      id: BF_ID,
      name: 'campaign-executor-bf',
      codename: 'CX',
      repoPath: '/tmp/nonexistent-cx',
      defaultBranch: 'main',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
}

interface MissionSpec {
  id: string;
  title?: string;
  deps?: string[];
  worktreeBranch?: string;
}
interface PhaseSpec {
  id: string;
  number: number;
  name: string;
  missions: MissionSpec[];
}

function seedCampaign(campaignId: string, status: string, phaseSpecs: PhaseSpec[]): void {
  const now = Date.now();
  db.insert(campaigns)
    .values({
      id: campaignId,
      battlefieldId: BF_ID,
      name: 'test-campaign',
      objective: 'test',
      status,
      currentPhase: 0,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  for (const ph of phaseSpecs) {
    db.insert(phases)
      .values({
        id: ph.id,
        campaignId,
        phaseNumber: ph.number,
        name: ph.name,
        status: 'standby',
        createdAt: now,
      })
      .run();
    for (const m of ph.missions) {
      db.insert(missions)
        .values({
          id: m.id,
          battlefieldId: BF_ID,
          campaignId,
          phaseId: ph.id,
          title: m.title ?? m.id,
          briefing: `briefing for ${m.id}`,
          type: 'combat',
          status: 'standby',
          dependsOn: m.deps && m.deps.length > 0 ? JSON.stringify(m.deps) : null,
          worktreeBranch: m.worktreeBranch ?? null,
          useWorktree: 0,
          createdAt: now,
          updatedAt: now,
        } as typeof missions.$inferInsert)
        .run();
    }
  }
}

function setMissionStatus(id: string, status: string): void {
  db.update(missions)
    .set({ status, updatedAt: Date.now() })
    .where(eq(missions.id, id))
    .run();
}

function getMission(id: string) {
  return db.select().from(missions).where(eq(missions.id, id)).get();
}
function getPhase(id: string) {
  return db.select().from(phases).where(eq(phases.id, id)).get();
}
function getCampaign(id: string) {
  return db.select().from(campaigns).where(eq(campaigns.id, id)).get();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('campaign executor — integration', () => {
  beforeEach(() => {
    cleanDb();
    seedBattlefield();
  });

  // -------------------------------------------------------------------------
  // 1. Launch 3-phase campaign — phase 1 active, no-dep missions queued
  // -------------------------------------------------------------------------
  it('launches a 3-phase campaign: phase 1 active, no-dep missions queued, rest STANDBY', () => {
    seedCampaign('c1', 'planning', [
      {
        id: 'p1',
        number: 1,
        name: 'recon',
        missions: [
          { id: 'm1a' }, // no deps
          { id: 'm1b', deps: ['m1a'] }, // depends on m1a
          { id: 'm1c' }, // no deps
        ],
      },
      {
        id: 'p2',
        number: 2,
        name: 'combat',
        missions: [{ id: 'm2a' }, { id: 'm2b' }],
      },
      {
        id: 'p3',
        number: 3,
        name: 'merge',
        missions: [{ id: 'm3a' }],
      },
    ]);

    launchCampaign('c1');

    expect(getCampaign('c1')?.status).toBe('active');
    expect(getPhase('p1')?.status).toBe('active');
    expect(getPhase('p2')?.status).toBe('standby');
    expect(getPhase('p3')?.status).toBe('standby');

    expect(getMission('m1a')?.status).toBe('queued');
    expect(getMission('m1b')?.status).toBe('standby');
    expect(getMission('m1c')?.status).toBe('queued');
    expect(getMission('m2a')?.status).toBe('standby');
    expect(getMission('m3a')?.status).toBe('standby');
  });

  // -------------------------------------------------------------------------
  // 2. Mission accomplished unblocks dependent
  // -------------------------------------------------------------------------
  it('unblocks a STANDBY dependent when its predecessor is ACCOMPLISHED', () => {
    seedCampaign('c2', 'planning', [
      {
        id: 'p1',
        number: 1,
        name: 'main',
        missions: [
          { id: 'a' },
          { id: 'b', deps: ['a'] },
        ],
      },
    ]);
    launchCampaign('c2');
    expect(getMission('a')?.status).toBe('queued');
    expect(getMission('b')?.status).toBe('standby');

    // simulate a reaching terminal
    setMissionStatus('a', 'accomplished');
    onMissionTerminal('a');

    expect(getMission('b')?.status).toBe('queued');
  });

  // -------------------------------------------------------------------------
  // 3. Phase settles SECURED → next phase activates
  // -------------------------------------------------------------------------
  it('settles phase 1 SECURED when all missions accomplished and activates phase 2', () => {
    seedCampaign('c3', 'planning', [
      { id: 'p1', number: 1, name: 'first', missions: [{ id: 'a' }, { id: 'b' }] },
      {
        id: 'p2',
        number: 2,
        name: 'second',
        missions: [{ id: 'c' }, { id: 'd', deps: ['c'] }],
      },
    ]);
    launchCampaign('c3');

    setMissionStatus('a', 'accomplished');
    onMissionTerminal('a');
    expect(getPhase('p1')?.status).toBe('active'); // b still pending

    setMissionStatus('b', 'accomplished');
    onMissionTerminal('b');

    expect(getPhase('p1')?.status).toBe('secured');
    expect(getPhase('p1')?.debrief).toContain('Phase 1');
    expect(getPhase('p2')?.status).toBe('active');
    expect(getMission('c')?.status).toBe('queued');
    expect(getMission('d')?.status).toBe('standby');
  });

  // -------------------------------------------------------------------------
  // 4. Phase settles COMPROMISED — campaign transitions via commander hook
  // -------------------------------------------------------------------------
  it('phase settles COMPROMISED; campaign → COMPROMISED when commander-hook fires and no progress possible', () => {
    seedCampaign('c4', 'planning', [
      {
        id: 'p1',
        number: 1,
        name: 'p1',
        missions: [{ id: 'a' }, { id: 'b' }],
      },
    ]);
    launchCampaign('c4');

    // a succeeds, b compromised
    setMissionStatus('a', 'accomplished');
    onMissionTerminal('a');

    setMissionStatus('b', 'compromised');
    onMissionTerminal('b');

    // Phase settled; no next phase → campaign settle kicks in, but since one
    // mission is compromised, the settle path marks campaign compromised (all
    // phases settled). Verify.
    expect(getPhase('p1')?.status).toBe('compromised');
    expect(getCampaign('c4')?.status).toBe('compromised');
  });

  // -------------------------------------------------------------------------
  // 4b. Commander-hook with an unresolved phase — campaign stays ACTIVE
  //     while there are still in-flight missions.
  // -------------------------------------------------------------------------
  it('keeps campaign ACTIVE while sibling missions still running (commander-hook)', () => {
    seedCampaign('c4b', 'planning', [
      {
        id: 'p1',
        number: 1,
        name: 'p1',
        missions: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      },
    ]);
    launchCampaign('c4b');
    // a running, b compromised, c running
    setMissionStatus('a', 'in_combat');
    setMissionStatus('b', 'compromised');
    setMissionStatus('c', 'in_combat');

    onMissionCompromisedAwaitingCommander('b');

    expect(getCampaign('c4b')?.status).toBe('active');
  });

  // -------------------------------------------------------------------------
  // 4c. Commander-hook fires when nothing else can progress
  // -------------------------------------------------------------------------
  it('commander-hook transitions campaign to COMPROMISED when a blocked STANDBY exists with no in-flight work', () => {
    seedCampaign('c4c', 'planning', [
      {
        id: 'p1',
        number: 1,
        name: 'p1',
        missions: [
          { id: 'a' },
          { id: 'b', deps: ['a'] }, // blocked when a compromised
        ],
      },
    ]);
    launchCampaign('c4c');
    // Simulate: a compromised, b still standby (blocked).
    setMissionStatus('a', 'compromised');
    onMissionCompromisedAwaitingCommander('a');

    expect(getCampaign('c4c')?.status).toBe('compromised');
  });

  // -------------------------------------------------------------------------
  // 5. Transitive cascade on ABANDONED
  // -------------------------------------------------------------------------
  it('cascades ABANDONED through a 3-deep chain of STANDBY dependents', () => {
    seedCampaign('c5', 'planning', [
      {
        id: 'p1',
        number: 1,
        name: 'p1',
        missions: [
          { id: 'root' },
          { id: 'd1', deps: ['root'] },
          { id: 'd2', deps: ['d1'] },
          { id: 'd3', deps: ['d2'] },
        ],
      },
    ]);
    launchCampaign('c5');

    abandonMission('root');

    expect(getMission('root')?.status).toBe('abandoned');
    expect(getMission('d1')?.status).toBe('abandoned');
    expect(getMission('d2')?.status).toBe('abandoned');
    expect(getMission('d3')?.status).toBe('abandoned');
    // Cascade reason recorded
    expect(getMission('d1')?.compromiseReason).toContain('dependency-cascade');
  });

  // -------------------------------------------------------------------------
  // 6. Tactical override
  // -------------------------------------------------------------------------
  it('tactical override resets sortie attempts, updates briefing, sets QUEUED', () => {
    seedCampaign('c6', 'planning', [
      { id: 'p1', number: 1, name: 'p1', missions: [{ id: 'm1' }] },
    ]);
    launchCampaign('c6');

    // Simulate the mission had attempts + is compromised
    db.update(missions)
      .set({
        status: 'compromised',
        currentSortieAttempts: 3,
        compromiseReason: 'gate-fail',
      })
      .where(eq(missions.id, 'm1'))
      .run();

    tacticalOverride('m1', 'new briefing: please try again');

    const m = getMission('m1');
    expect(m?.status).toBe('queued');
    expect(m?.briefing).toBe('new briefing: please try again');
    expect(m?.currentSortieAttempts).toBe(0);
    expect(m?.compromiseReason).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 7. Accept & merge — inject a stub merge to keep this test DB-focused.
  //    Real simple-git merging is validated in tests/control/integration/merge.test.ts.
  // -------------------------------------------------------------------------
  it('accept & merge marks mission ACCOMPLISHED and unblocks dependents', async () => {
    seedCampaign('c7', 'planning', [
      {
        id: 'p1',
        number: 1,
        name: 'p1',
        missions: [
          { id: 'm1', worktreeBranch: 'devroom/m1' },
          { id: 'm2', deps: ['m1'] },
        ],
      },
    ]);
    launchCampaign('c7');

    setMissionStatus('m1', 'compromised');

    let mergeCalled = false;
    await acceptAndMerge('m1', {
      runMerge: async () => {
        mergeCalled = true;
      },
    });

    expect(mergeCalled).toBe(true);
    expect(getMission('m1')?.status).toBe('accomplished');
    expect(getMission('m1')?.mergeResult).toBe('clean');
    // m2 had its deps satisfied → queued
    expect(getMission('m2')?.status).toBe('queued');
  });

  // -------------------------------------------------------------------------
  // 8. Campaign accomplished when all phases SECURED
  // -------------------------------------------------------------------------
  it('campaign → ACCOMPLISHED when every phase settles SECURED', () => {
    seedCampaign('c8', 'planning', [
      { id: 'p1', number: 1, name: 'p1', missions: [{ id: 'a' }] },
      { id: 'p2', number: 2, name: 'p2', missions: [{ id: 'b' }] },
    ]);
    launchCampaign('c8');

    setMissionStatus('a', 'accomplished');
    onMissionTerminal('a');
    expect(getPhase('p1')?.status).toBe('secured');
    expect(getPhase('p2')?.status).toBe('active');
    expect(getMission('b')?.status).toBe('queued');

    setMissionStatus('b', 'accomplished');
    onMissionTerminal('b');

    expect(getPhase('p2')?.status).toBe('secured');
    expect(getCampaign('c8')?.status).toBe('accomplished');
    expect(getCampaign('c8')?.debrief).toContain('Phase 1');
    expect(getCampaign('c8')?.debrief).toContain('Phase 2');
  });
});
