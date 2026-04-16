/**
 * Campaign executor — phase-by-phase progression with dependency unblocking
 * and cascade-on-ABANDONED per spec §8.
 *
 * Pure-ish module: DB + logic only. No subprocess. CONTROL's dispatch loop
 * picks up missions transitioned to `queued`.
 *
 * Status literals are the canonical lowercase DB values:
 *  - campaign:  draft | planning | active | compromised | accomplished | abandoned
 *  - phase:     standby | active | secured | compromised
 *  - mission:   standby | queued | deploying | in_combat | reviewing |
 *               approved | merging | accomplished | compromised | abandoned
 */

import { eq } from 'drizzle-orm';
import simpleGit from 'simple-git';

import { getDatabase } from '@/lib/db';
import { campaigns, phases, missions, battlefields } from '@/lib/db/schema';
import { emitComm } from '@/control/comms';
import { findTransitiveDependents } from '@/control/campaign/dependency-graph';
import { composePhaseDebrief } from '@/control/campaign/debrief';
import type { Debrief } from '@/control/debrief/schema';
import type { EscalationQuestion } from '@/lib/telegram/notifier';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IN_FLIGHT = new Set(['queued', 'deploying', 'in_combat', 'merging']);
const TERMINAL_STATES = new Set(['accomplished', 'compromised', 'abandoned']);

function parseDeps(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  } catch {
    // fall through
  }
  return [];
}

function parseDebrief(raw: string | null | undefined): Debrief | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === 'object') return v as Debrief;
  } catch {
    // fall through
  }
  return null;
}

function loadMission(id: string) {
  const db = getDatabase();
  const m = db.select().from(missions).where(eq(missions.id, id)).get();
  if (!m) throw new Error(`executor: mission ${id} not found`);
  return m;
}

function loadPhase(id: string) {
  const db = getDatabase();
  const p = db.select().from(phases).where(eq(phases.id, id)).get();
  if (!p) throw new Error(`executor: phase ${id} not found`);
  return p;
}

function loadCampaign(id: string) {
  const db = getDatabase();
  const c = db.select().from(campaigns).where(eq(campaigns.id, id)).get();
  if (!c) throw new Error(`executor: campaign ${id} not found`);
  return c;
}

function listPhaseMissions(phaseId: string) {
  const db = getDatabase();
  return db.select().from(missions).where(eq(missions.phaseId, phaseId)).all();
}

function listCampaignPhases(campaignId: string) {
  const db = getDatabase();
  return db
    .select()
    .from(phases)
    .where(eq(phases.campaignId, campaignId))
    .all()
    .sort((a, b) => a.phaseNumber - b.phaseNumber);
}

// ---------------------------------------------------------------------------
// 1. launchCampaign
// ---------------------------------------------------------------------------

export function launchCampaign(campaignId: string): void {
  const db = getDatabase();
  const campaign = loadCampaign(campaignId);
  if (campaign.status !== 'draft' && campaign.status !== 'planning') {
    throw new Error(
      `executor: cannot launch campaign ${campaignId} from status ${campaign.status}`,
    );
  }

  const phaseRows = listCampaignPhases(campaignId);
  if (phaseRows.length === 0) {
    throw new Error(`executor: campaign ${campaignId} has no phases`);
  }

  const firstPhase = phaseRows[0];
  const phaseMissions = listPhaseMissions(firstPhase.id);

  db.transaction(() => {
    const now = Date.now();
    db.update(campaigns)
      .set({ status: 'active', currentPhase: firstPhase.phaseNumber, updatedAt: now })
      .where(eq(campaigns.id, campaignId))
      .run();

    db.update(phases).set({ status: 'active' }).where(eq(phases.id, firstPhase.id)).run();

    for (const m of phaseMissions) {
      const deps = parseDeps(m.dependsOn);
      const nextStatus = deps.length === 0 ? 'queued' : 'standby';
      db.update(missions)
        .set({ status: nextStatus, updatedAt: now })
        .where(eq(missions.id, m.id))
        .run();
    }
  });

  emitComm({
    campaignId,
    battlefieldId: campaign.battlefieldId,
    actor: 'CONTROL',
    message: `Campaign launched — phase ${firstPhase.phaseNumber} (${firstPhase.name}) active`,
  });
}

// ---------------------------------------------------------------------------
// 2. onMissionTerminal — dependency unblocking + phase/campaign settlement
// ---------------------------------------------------------------------------

export function onMissionTerminal(missionId: string): void {
  const mission = loadMission(missionId);
  if (!TERMINAL_STATES.has(mission.status ?? '')) {
    throw new Error(
      `executor: mission ${missionId} is not terminal (status=${mission.status})`,
    );
  }
  if (!mission.phaseId || !mission.campaignId) {
    // Standalone mission — nothing to progress.
    return;
  }

  const phaseId = mission.phaseId;
  const campaignId = mission.campaignId;

  // --- 1. cascade on ABANDONED -------------------------------------------
  if (mission.status === 'abandoned') {
    cascadeAbandon(missionId, phaseId, campaignId, mission.battlefieldId);
  }

  // --- 2. checkDependencies: unblock STANDBY missions whose deps are all
  //     ACCOMPLISHED -------------------------------------------------------
  unblockPhaseDependents(phaseId);

  // --- 3. phase settlement -----------------------------------------------
  const phaseMissions = listPhaseMissions(phaseId);
  const allTerminal = phaseMissions.every((m) => TERMINAL_STATES.has(m.status ?? ''));
  if (!allTerminal) return;

  settlePhase(phaseId, campaignId);
}

function cascadeAbandon(
  originId: string,
  phaseId: string,
  campaignId: string,
  battlefieldId: string,
): void {
  const db = getDatabase();
  const phaseMissions = listPhaseMissions(phaseId);
  const view = phaseMissions.map((m) => ({
    id: m.id,
    dependsOn: parseDeps(m.dependsOn),
    status: m.status ?? 'standby',
  }));

  // Expand the graph by re-adding the origin (it may already be abandoned).
  const cascaded = findTransitiveDependents(originId, view);
  if (cascaded.length === 0) return;

  const now = Date.now();
  db.transaction(() => {
    for (const id of cascaded) {
      db.update(missions)
        .set({
          status: 'abandoned',
          compromiseReason: `dependency-cascade:${originId}`,
          updatedAt: now,
        })
        .where(eq(missions.id, id))
        .run();
    }
  });

  for (const id of cascaded) {
    emitComm({
      missionId: id,
      campaignId,
      battlefieldId,
      actor: 'CONTROL',
      message: `Mission cascaded to ABANDONED (origin ${originId})`,
      level: 'warn',
    });
  }
}

function unblockPhaseDependents(phaseId: string): void {
  const db = getDatabase();
  const phaseMissions = listPhaseMissions(phaseId);
  const byId = new Map(phaseMissions.map((m) => [m.id, m]));

  const toUnblock: string[] = [];
  for (const m of phaseMissions) {
    if (m.status !== 'standby') continue;
    const deps = parseDeps(m.dependsOn);
    if (deps.length === 0) {
      toUnblock.push(m.id);
      continue;
    }
    const allDone = deps.every((depId) => {
      const dep = byId.get(depId);
      return dep && dep.status === 'accomplished';
    });
    if (allDone) toUnblock.push(m.id);
  }

  if (toUnblock.length === 0) return;
  const now = Date.now();
  db.transaction(() => {
    for (const id of toUnblock) {
      db.update(missions)
        .set({ status: 'queued', updatedAt: now })
        .where(eq(missions.id, id))
        .run();
    }
  });

  for (const id of toUnblock) {
    const m = byId.get(id);
    emitComm({
      missionId: id,
      campaignId: m?.campaignId ?? undefined,
      battlefieldId: m?.battlefieldId ?? undefined,
      actor: 'CONTROL',
      message: 'Mission dependencies satisfied — QUEUED',
    });
  }
}

function settlePhase(phaseId: string, campaignId: string): void {
  const db = getDatabase();
  const phase = loadPhase(phaseId);
  const phaseMissions = listPhaseMissions(phaseId);

  const allAccomplished = phaseMissions.every((m) => m.status === 'accomplished');
  const nextPhaseStatus: 'secured' | 'compromised' = allAccomplished ? 'secured' : 'compromised';

  // Compose debrief (deterministic).
  const totalTokens = phaseMissions.reduce(
    (sum, m) =>
      sum +
      (m.costInput ?? 0) +
      (m.costOutput ?? 0) +
      (m.costCacheHit ?? 0),
    0,
  );
  const phaseStart = phase.createdAt ?? Date.now();
  const phaseEnd = Date.now();
  const durationMs = Math.max(0, phaseEnd - phaseStart);

  const debrief = composePhaseDebrief({
    phase: {
      id: phase.id,
      name: phase.name,
      order: phase.phaseNumber,
      status: nextPhaseStatus,
    },
    missions: phaseMissions.map((m) => ({
      title: m.title,
      status: (m.status ?? '').toUpperCase(),
      debriefStructured: parseDebrief(m.debriefStructured),
    })),
    durationMs,
    totalTokens,
    totalPhases: listCampaignPhases(campaignId).length,
  });

  db.transaction(() => {
    db.update(phases)
      .set({ status: nextPhaseStatus, debrief, durationMs, totalTokens, completingAt: phaseEnd })
      .where(eq(phases.id, phaseId))
      .run();
  });

  const campaign = loadCampaign(campaignId);
  emitComm({
    campaignId,
    battlefieldId: campaign.battlefieldId,
    actor: 'CONTROL',
    message: `Phase ${phase.phaseNumber} (${phase.name}) → ${nextPhaseStatus.toUpperCase()}`,
    level: nextPhaseStatus === 'secured' ? 'info' : 'warn',
  });

  // Advance
  const allPhases = listCampaignPhases(campaignId);
  const idx = allPhases.findIndex((p) => p.id === phaseId);
  const nextPhase = idx >= 0 ? allPhases[idx + 1] : undefined;

  if (nextPhase) {
    activatePhase(nextPhase.id, campaignId);
  } else {
    settleCampaign(campaignId);
  }
}

function activatePhase(phaseId: string, campaignId: string): void {
  const db = getDatabase();
  const phase = loadPhase(phaseId);
  const phaseMissions = listPhaseMissions(phaseId);
  const now = Date.now();

  db.transaction(() => {
    db.update(phases).set({ status: 'active' }).where(eq(phases.id, phaseId)).run();
    db.update(campaigns)
      .set({ currentPhase: phase.phaseNumber, updatedAt: now })
      .where(eq(campaigns.id, campaignId))
      .run();

    for (const m of phaseMissions) {
      const deps = parseDeps(m.dependsOn);
      const nextStatus = deps.length === 0 ? 'queued' : 'standby';
      db.update(missions)
        .set({ status: nextStatus, updatedAt: now })
        .where(eq(missions.id, m.id))
        .run();
    }
  });

  const campaign = loadCampaign(campaignId);
  emitComm({
    campaignId,
    battlefieldId: campaign.battlefieldId,
    actor: 'CONTROL',
    message: `Phase ${phase.phaseNumber} (${phase.name}) activated`,
  });
}

function settleCampaign(campaignId: string): void {
  const db = getDatabase();
  const campaign = loadCampaign(campaignId);
  const allPhases = listCampaignPhases(campaignId);
  const allSecured = allPhases.every((p) => p.status === 'secured');
  const nextStatus = allSecured ? 'accomplished' : 'compromised';

  // Assemble campaign debrief = concat of phase debriefs.
  const combined = allPhases
    .map((p) => p.debrief ?? `# Phase ${p.phaseNumber}: ${p.name}\n(no debrief)`)
    .join('\n\n');

  db.update(campaigns)
    .set({ status: nextStatus, debrief: combined, updatedAt: Date.now() })
    .where(eq(campaigns.id, campaignId))
    .run();

  emitComm({
    campaignId,
    battlefieldId: campaign.battlefieldId,
    actor: 'CONTROL',
    message: `Campaign → ${nextStatus.toUpperCase()}`,
    level: nextStatus === 'accomplished' ? 'info' : 'error',
  });

  // Notify Commander via Telegram (fire-and-forget; failure must not break CONTROL).
  if (nextStatus === 'accomplished') {
    import('@/lib/telegram/notifier')
      .then(({ notifyCampaignAccomplished }) => notifyCampaignAccomplished(campaignId))
      .catch((err) => console.error('[CONTROL] notifyCampaignAccomplished failed:', err));
  } else {
    import('@/lib/telegram/notifier')
      .then(({ notifyCampaignCompromised }) => notifyCampaignCompromised(campaignId))
      .catch((err) => console.error('[CONTROL] notifyCampaignCompromised failed:', err));
  }
}

// ---------------------------------------------------------------------------
// 3. onMissionCompromisedAwaitingCommander
// ---------------------------------------------------------------------------

/**
 * Per spec §8.2 item 10: campaign transitions to `compromised` iff
 *   - no missions in QUEUED/DEPLOYING/IN_COMBAT/MERGING
 *   - at least one mission in COMPROMISED
 *   - any STANDBY missions present are blocked-not-waiting: their
 *     dependencies resolved into COMPROMISED/ABANDONED
 *
 * Pure dependency-waiting (deps still running) keeps the campaign ACTIVE.
 */
export function onMissionCompromisedAwaitingCommander(
  missionId: string,
  escalationQuestion?: EscalationQuestion,
): void {
  const db = getDatabase();
  const mission = loadMission(missionId);
  if (!mission.campaignId) return;
  const campaignId = mission.campaignId;
  const campaign = loadCampaign(campaignId);
  if (campaign.status !== 'active') return;

  const allMissions = db
    .select()
    .from(missions)
    .where(eq(missions.campaignId, campaignId))
    .all();

  const anyInFlight = allMissions.some((m) => IN_FLIGHT.has(m.status ?? ''));
  if (anyInFlight) return;
  const anyCompromised = allMissions.some((m) => m.status === 'compromised');
  if (!anyCompromised) return;

  // Inspect STANDBY missions. If all their deps are terminal non-ACCOMPLISHED,
  // they are blocked-not-waiting. If any STANDBY mission still has a
  // non-terminal dependency, it's pure-waiting (impossible given no in-flight,
  // but guard regardless).
  const byId = new Map(allMissions.map((m) => [m.id, m]));
  let blockedStandbyExists = false;
  let pureWaitingExists = false;

  for (const m of allMissions) {
    if (m.status !== 'standby') continue;
    const deps = parseDeps(m.dependsOn);
    if (deps.length === 0) {
      // Should have been queued; treat as pure-waiting so we don't incorrectly
      // mark the campaign compromised.
      pureWaitingExists = true;
      continue;
    }
    const depStatuses = deps.map((d) => byId.get(d)?.status ?? 'missing');
    const allTerminal = depStatuses.every((s) => TERMINAL_STATES.has(s));
    const anyAccomplished = depStatuses.some((s) => s === 'accomplished');
    if (!allTerminal) {
      pureWaitingExists = true;
    } else if (!anyAccomplished || depStatuses.some((s) => s === 'compromised' || s === 'abandoned')) {
      // All deps terminal, with at least one non-ACCOMPLISHED → blocked.
      blockedStandbyExists = true;
    }
  }

  // If there are STANDBY missions whose deps are still running, we are still
  // making forward progress — don't compromise. (In practice in-flight check
  // above already covers this, but explicit is better.)
  if (pureWaitingExists) return;

  // If no STANDBY missions exist at all, and nothing is in-flight, and there
  // is a COMPROMISED mission, the campaign is stuck awaiting Commander too.
  void blockedStandbyExists; // satisfied

  db.update(campaigns)
    .set({ status: 'compromised', updatedAt: Date.now() })
    .where(eq(campaigns.id, campaignId))
    .run();

  emitComm({
    campaignId,
    battlefieldId: campaign.battlefieldId,
    actor: 'CONTROL',
    message: 'Campaign → COMPROMISED — Commander input required',
    level: 'error',
  });

  // Notify Commander via Telegram (fire-and-forget; failure must not break CONTROL).
  import('@/lib/telegram/notifier')
    .then(({ notifyMissionCompromised }) =>
      notifyMissionCompromised(missionId, escalationQuestion),
    )
    .catch((err) => console.error('[CONTROL] notifyMissionCompromised failed:', err));
}

// ---------------------------------------------------------------------------
// 4. tacticalOverride
// ---------------------------------------------------------------------------

export function tacticalOverride(missionId: string, newBriefing: string): void {
  const db = getDatabase();
  const mission = loadMission(missionId);
  const now = Date.now();
  db.transaction(() => {
    db.update(missions)
      .set({
        briefing: newBriefing,
        currentSortieAttempts: 0,
        status: 'queued',
        compromiseReason: null,
        updatedAt: now,
      })
      .where(eq(missions.id, missionId))
      .run();
  });
  emitComm({
    missionId,
    campaignId: mission.campaignId ?? undefined,
    battlefieldId: mission.battlefieldId,
    actor: 'COMMANDER',
    message: 'Tactical Override — briefing updated, mission re-queued',
  });
}

// ---------------------------------------------------------------------------
// 5. abandonMission
// ---------------------------------------------------------------------------

export interface AbandonOpts {
  preserveBranch?: boolean;
  reason?: string;
}

export function abandonMission(missionId: string, opts: AbandonOpts = {}): void {
  const db = getDatabase();
  const mission = loadMission(missionId);
  const now = Date.now();
  db.transaction(() => {
    db.update(missions)
      .set({
        status: 'abandoned',
        compromiseReason: opts.reason ?? 'commander-abandon',
        updatedAt: now,
        completedAt: now,
      })
      .where(eq(missions.id, missionId))
      .run();
  });

  emitComm({
    missionId,
    campaignId: mission.campaignId ?? undefined,
    battlefieldId: mission.battlefieldId,
    actor: 'COMMANDER',
    message: 'Mission ABANDONED',
    level: 'warn',
  });

  // Cascade + phase/campaign settlement happens via onMissionTerminal.
  onMissionTerminal(missionId);

  // Worktree removal is caller-controlled (Server Action layer wires the
  // worktree module). `preserveBranch` is surfaced so the caller can act on
  // it. The executor records the choice in comms for auditability.
  if (opts.preserveBranch) {
    emitComm({
      missionId,
      campaignId: mission.campaignId ?? undefined,
      battlefieldId: mission.battlefieldId,
      actor: 'CONTROL',
      message: 'Worktree branch preserved (Commander opt-in)',
    });
  }
}

// ---------------------------------------------------------------------------
// 6. acceptAndMerge
// ---------------------------------------------------------------------------

export interface AcceptAndMergeDeps {
  runMerge?: (opts: {
    repoPath: string;
    targetBranch: string;
    sourceBranch: string;
  }) => Promise<void>;
}

/**
 * Force-merge the mission's current worktree branch into the battlefield's
 * default (target) branch. Sets the mission to ACCOMPLISHED and cascades
 * dependent unblocking via onMissionTerminal.
 *
 * The merge itself defaults to a real simple-git invocation
 * (`git checkout target && git merge --no-ff <source>`). Tests may inject a
 * stub via `deps.runMerge`.
 */
export async function acceptAndMerge(
  missionId: string,
  deps: AcceptAndMergeDeps = {},
): Promise<void> {
  const db = getDatabase();
  const mission = loadMission(missionId);
  const battlefield = db
    .select()
    .from(battlefields)
    .where(eq(battlefields.id, mission.battlefieldId))
    .get();
  if (!battlefield) throw new Error(`executor: battlefield ${mission.battlefieldId} not found`);

  const sourceBranch = mission.worktreeBranch;
  const targetBranch = battlefield.defaultBranch ?? 'main';
  const repoPath = battlefield.repoPath;

  const runner =
    deps.runMerge ??
    (async (o) => {
      const git = simpleGit(o.repoPath);
      await git.checkout(o.targetBranch);
      await git.raw(['merge', '--no-ff', o.sourceBranch, '-m', `merge(mission): accept-and-merge ${missionId}`]);
    });

  if (sourceBranch) {
    await runner({ repoPath, targetBranch, sourceBranch });
  }

  const now = Date.now();
  db.transaction(() => {
    db.update(missions)
      .set({
        status: 'accomplished',
        mergeResult: 'clean',
        mergeTimestamp: now,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(missions.id, missionId))
      .run();
  });

  emitComm({
    missionId,
    campaignId: mission.campaignId ?? undefined,
    battlefieldId: mission.battlefieldId,
    actor: 'COMMANDER',
    message: 'Accept & Merge — mission ACCOMPLISHED',
  });

  onMissionTerminal(missionId);
}
