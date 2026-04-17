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
import { emitComm, emitMissionStatus } from '@/control/comms';
import { findTransitiveDependents } from '@/control/campaign/dependency-graph';
import { composePhaseDebrief } from '@/control/campaign/debrief';
import type { Debrief } from '@/control/debrief/schema';
import type { EscalationQuestion } from '@/lib/telegram/notifier';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IN_FLIGHT = new Set(['queued', 'deploying', 'in_combat', 'merging']);
const TERMINAL_STATES = new Set(['accomplished', 'compromised', 'abandoned']);

/**
 * Mission states that mean "the dispatcher considers it live work" — anything
 * queued for dispatch or actively running. Used by pauseCampaign to refuse
 * pausing while real work is in flight (a paused campaign with an `in_combat`
 * mission is internally inconsistent — the dispatcher would keep the mission
 * running and would even pick up freshly queued ones, making "paused" a
 * UI-only fiction).
 *
 * `standby` is intentionally NOT in this set: a mission with unsatisfied deps
 * is dormant from the dispatcher's perspective, so pausing a campaign whose
 * remaining work is all dependency-blocked is fine.
 */
const LIVE_MISSION_STATES = new Set([
  'queued',
  'deploying',
  'in_combat',
  'merging',
]);

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
// 1b. pauseCampaign
// ---------------------------------------------------------------------------

export interface PauseOpts {
  reason?: string;
}

/**
 * Flip a campaign to PAUSED. Refuses when any mission is queued, deploying,
 * in_combat, or merging — pausing under those conditions is a UI-only fiction
 * because the dispatcher would keep them running, leaving the campaign in an
 * internally inconsistent state. Only callable from `active`.
 *
 * Standby missions (dependency-blocked) are fine to leave around — they
 * aren't doing anything the dispatcher cares about.
 */
export function pauseCampaign(campaignId: string, opts: PauseOpts = {}): void {
  const db = getDatabase();
  const campaign = loadCampaign(campaignId);
  if (campaign.status !== 'active') {
    throw new Error(
      `pauseCampaign: campaign must be active to pause (current: ${campaign.status})`,
    );
  }

  const liveMissions = db
    .select({ id: missions.id, title: missions.title, status: missions.status })
    .from(missions)
    .where(eq(missions.campaignId, campaignId))
    .all()
    .filter((m) => LIVE_MISSION_STATES.has(m.status ?? ''));

  if (liveMissions.length > 0) {
    const summary = liveMissions
      .slice(0, 3)
      .map((m) => `"${m.title}" (${m.status})`)
      .join(', ');
    const more = liveMissions.length > 3 ? ` and ${liveMissions.length - 3} more` : '';
    throw new Error(
      `pauseCampaign: cannot pause while ${liveMissions.length} mission${liveMissions.length === 1 ? ' is' : 's are'} live — ${summary}${more}. Wait for them to finish or abandon them first.`,
    );
  }

  db.update(campaigns)
    .set({
      status: 'paused',
      stallReason: opts.reason ?? null,
      updatedAt: Date.now(),
    })
    .where(eq(campaigns.id, campaignId))
    .run();

  emitComm({
    campaignId,
    battlefieldId: campaign.battlefieldId,
    actor: 'CONTROL',
    message: `Campaign paused${opts.reason ? `: ${opts.reason}` : ''}`,
    level: 'warn',
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
  // dependsOn is stored as TITLES (per briefing-contract). To make the graph
  // traversal work, identify nodes by title — including the origin. Match
  // back to mission.id at write time so we can update the right rows.
  const view = phaseMissions.map((m) => ({
    id: m.title,
    dependsOn: parseDeps(m.dependsOn),
    status: m.status ?? 'standby',
  }));

  const origin = phaseMissions.find((m) => m.id === originId);
  if (!origin) return;

  const cascadedTitles = findTransitiveDependents(origin.title, view);
  if (cascadedTitles.length === 0) return;

  const titleToId = new Map(phaseMissions.map((m) => [m.title, m.id]));
  const cascaded = cascadedTitles
    .map((t) => titleToId.get(t))
    .filter((id): id is string => Boolean(id));
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
  // STRATEGIST emits dependsOn as mission TITLES (per briefing-contract.ts),
  // and `campaign-helpers.insertCampaign` stores them verbatim. Look up by
  // title here — looking up by id silently never matches and leaves the
  // dependent stuck in standby forever (hit on Phase 4 of OPERATION
  // BEGINNINGS: the "Create Account reference Server Action" mission
  // depending on "All §3 route pages with empty states").
  const byTitle = new Map(phaseMissions.map((m) => [m.title, m]));

  const toUnblock: string[] = [];
  for (const m of phaseMissions) {
    if (m.status !== 'standby') continue;
    const deps = parseDeps(m.dependsOn);
    if (deps.length === 0) {
      toUnblock.push(m.id);
      continue;
    }
    const allDone = deps.every((depTitle) => {
      const dep = byTitle.get(depTitle);
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

  const byMissionId = new Map(phaseMissions.map((m) => [m.id, m]));
  for (const id of toUnblock) {
    const m = byMissionId.get(id);
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

  // Advance ONLY when every mission in the current phase landed
  // ACCOMPLISHED. A single COMPROMISED or ABANDONED mission halts the
  // campaign — the Commander decides what to do next (re-queue the failed
  // mission via Tactical Override, abandon the campaign, etc.). When the
  // re-queued mission later lands ACCOMPLISHED, `onMissionTerminal` will
  // call `settlePhase` again and the cascade resumes.
  if (!allAccomplished) {
    settleCampaign(campaignId);
    return;
  }

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
        mergeConflictFiles: null,
        updatedAt: now,
        completedAt: null,
      })
      .where(eq(missions.id, missionId))
      .run();

    // If the mission belongs to a settled phase / campaign, reset both back
    // to ACTIVE so that when the re-queued mission lands ACCOMPLISHED,
    // settlePhase fires again and the cascade resumes. Without this,
    // re-queueing a mission inside a COMPROMISED phase is a no-op for the
    // campaign — it runs, succeeds, and nothing advances.
    if (mission.phaseId) {
      db.update(phases)
        .set({ status: 'active', completingAt: null, debrief: null })
        .where(eq(phases.id, mission.phaseId))
        .run();
    }
    if (mission.campaignId) {
      db.update(campaigns)
        .set({ status: 'active', updatedAt: now })
        .where(eq(campaigns.id, mission.campaignId))
        .run();
    }
  });

  emitComm({
    missionId,
    campaignId: mission.campaignId ?? undefined,
    battlefieldId: mission.battlefieldId,
    actor: 'COMMANDER',
    message: 'Tactical Override — briefing updated, mission re-queued, phase reset to ACTIVE',
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

  // Resolve the source branch. Prefer the persisted value; fall back to the
  // runner's naming convention. Error loudly if neither yields a branch that
  // actually exists — a silent no-op followed by a success message is worse
  // than a failure (it has happened in the wild and misled the Commander).
  const targetBranch = battlefield.defaultBranch ?? 'main';
  const repoPath = battlefield.repoPath;
  const candidateBranch = mission.worktreeBranch ?? `devroom/${missionId}`;

  // Probe the branch only when running the real (default) git runner. Tests
  // inject a mock runMerge with stub repo paths and don't need (or want) a
  // real git probe. In production, verify the branch exists before declaring
  // success — a silent no-op followed by a success message has misled the
  // Commander before.
  const sourceBranch = candidateBranch;
  if (!deps.runMerge) {
    try {
      const probe = simpleGit(repoPath);
      await probe.revparse([candidateBranch]);
    } catch {
      throw new Error(
        `acceptAndMerge: mission ${missionId} has no resolvable worktree branch ` +
        `(tried "${candidateBranch}"). Cannot merge — mission state NOT changed.`,
      );
    }
  }

  const runner =
    deps.runMerge ??
    (async (o) => {
      const git = simpleGit(o.repoPath);
      await git.checkout(o.targetBranch);
      await git.raw(['merge', '--no-ff', o.sourceBranch, '-m', `merge(mission): accept-and-merge ${missionId}`]);
    });

  // Run the merge FIRST. Only mark accomplished if git actually accepted the
  // merge. If the runner throws, the catch block surfaces the real git error
  // and leaves the mission status untouched.
  try {
    await runner({ repoPath, targetBranch, sourceBranch });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitComm({
      missionId,
      campaignId: mission.campaignId ?? undefined,
      battlefieldId: mission.battlefieldId,
      actor: 'COMMANDER',
      level: 'error',
      message: `Accept & Merge failed: ${msg}`,
    });
    throw new Error(`acceptAndMerge: git merge failed for ${missionId}: ${msg}`);
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
        worktreeBranch: sourceBranch,
      })
      .where(eq(missions.id, missionId))
      .run();
  });

  emitMissionStatus(missionId, 'accomplished', {
    campaignId: mission.campaignId ?? null,
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
