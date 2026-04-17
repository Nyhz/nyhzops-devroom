/**
 * Production dependency wiring for CONTROL.
 *
 * Assembles the concrete `MissionRunnerDeps` used in the real server from
 * the various CONTROL subsystem implementations. Tests inject their own stubs.
 *
 * Called once at server boot (server.ts) and passed to `new Control(...)`.
 */

import type { Server as SocketIOServer } from 'socket.io';
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db';
import { assets, battlefields, missions } from '@/lib/db/schema';
import type { GateManifest } from './gates';
import { runGates } from './gates';
import { classifyExit, type ClassifierDeps } from './exit-classifier';
import { runMerge } from './merge';
import {
  createMissionWorktree,
  resetWorktreeToHead,
  rebaseOntoTarget,
  autoCommitSweep,
  removeMissionWorktree,
} from './worktree';
import { spawnAsset, spawnClaudeOneShot } from './spawn-asset';
import type { SpawnAssetOpts, AssetRunResult, MissionRunnerDeps, OverseerConsultInput, OverseerVerdict, MergeOpts, MergeResult } from './mission-runner';
import { buildOverseerClassificationPrompt, buildOverseerConsultPrompt } from './prompt-builder';
import { getRulesOfEngagement } from '@/lib/settings/rules-of-engagement';
import type { AssetDefinition } from './spawn-asset';

// ---------------------------------------------------------------------------
// Asset lookup + spawn adapter
// ---------------------------------------------------------------------------

function makeProductionSpawnAsset(): (opts: SpawnAssetOpts) => Promise<AssetRunResult> {
  return async (opts: SpawnAssetOpts): Promise<AssetRunResult> => {
    const db = getDatabase();
    const assetRow = db
      .select()
      .from(assets)
      .where(eq(assets.codename, opts.assetCodename))
      .get();

    if (!assetRow) {
      throw new Error(`productionSpawnAsset: asset "${opts.assetCodename}" not found`);
    }

    const asset: AssetDefinition = {
      codename: assetRow.codename,
      model: assetRow.model ?? 'claude-sonnet-4-6',
      maxTurns: assetRow.maxTurns ?? 30,
      effort: assetRow.effort ?? 'medium',
      isSystem: assetRow.isSystem ?? 0,
      systemPrompt: assetRow.systemPrompt ?? '',
      skills: assetRow.skills ? (JSON.parse(assetRow.skills) as string[]) : [],
      mcpServers: assetRow.mcpServers ? (JSON.parse(assetRow.mcpServers) as unknown[]) : [],
    };

    return spawnAsset({
      ...opts,
      asset,
      rulesOfEngagement: asset.isSystem ? '' : getRulesOfEngagement(),
    });
  };
}

// ---------------------------------------------------------------------------
// Overseer consult adapter
// ---------------------------------------------------------------------------

async function getOverseerAsset(): Promise<AssetDefinition> {
  const db = getDatabase();
  const row = db.select().from(assets).where(eq(assets.codename, 'OVERSEER')).get();
  if (!row) throw new Error('OVERSEER asset not found. Run seed.');
  return {
    codename: row.codename,
    model: row.model ?? 'claude-sonnet-4-6',
    maxTurns: row.maxTurns ?? 5,
    effort: row.effort ?? 'medium',
    isSystem: row.isSystem ?? 1,
    systemPrompt: row.systemPrompt ?? '',
    skills: row.skills ? (JSON.parse(row.skills) as string[]) : [],
    mcpServers: row.mcpServers ? (JSON.parse(row.mcpServers) as unknown[]) : [],
  };
}

async function productionOverseerConsult(
  input: OverseerConsultInput,
): Promise<OverseerVerdict> {
  const db = getDatabase();
  const mission = db.select().from(missions).where(eq(missions.id, input.missionId)).get();
  if (!mission) throw new Error(`productionOverseerConsult: mission ${input.missionId} not found`);

  const bf = db.select().from(battlefields).where(eq(battlefields.id, mission.battlefieldId)).get();
  if (!bf) throw new Error(`productionOverseerConsult: battlefield not found`);

  const overseerAsset = await getOverseerAsset();
  const prompt = buildOverseerConsultPrompt({
    briefing: input.briefing,
    attemptSummaries: (input.attemptHistory as Array<{ line?: string }>).map(
      (a, i) => ({ line: a?.line ?? `Attempt ${i + 1}` }),
    ),
    gateStderr: input.lastGateStderr || null,
    finalDiff: input.finalDiff || null,
    claudeMdExcerpt: input.claudeMdExcerpt ?? '',
  });

  const result = await spawnClaudeOneShot({
    missionId: input.missionId,
    cwd: bf.repoPath,
    briefing: prompt,
    asset: overseerAsset,
    rulesOfEngagement: '',
    hardTimeoutMs: 120_000,
  });

  // Parse the OVERSEER verdict from the JSON payload
  try {
    const parsed = result.json as {
      verdict?: string;
      reasoning?: string;
      redirect?: { newPrompt: string; focusHint: string };
      question?: string;
      options?: string[];
    };
    if (parsed.verdict === 'redirect' && parsed.redirect) {
      return {
        verdict: 'redirect',
        reasoning: parsed.reasoning ?? '',
        redirect: parsed.redirect,
      };
    }
    if (parsed.verdict === 'escalate' || parsed.question) {
      return {
        verdict: 'escalate',
        reasoning: parsed.reasoning ?? '',
        escalate: { question: parsed.question ?? 'OVERSEER requests Commander input.', options: parsed.options },
      };
    }
  } catch {
    // Fall through to default escalation
  }

  // Default: escalate with the raw JSON stringified
  return {
    verdict: 'escalate',
    reasoning: 'OVERSEER produced non-structured response',
    escalate: { question: JSON.stringify(result.json) ?? 'OVERSEER requests Commander input.' },
  };
}

// ---------------------------------------------------------------------------
// Merge adapter
// ---------------------------------------------------------------------------

async function productionMergeFn(opts: MergeOpts): Promise<MergeResult> {
  const db = getDatabase();
  const mission = db.select().from(missions).where(eq(missions.id, opts.missionId)).get();
  if (!mission) throw new Error(`productionMergeFn: mission ${opts.missionId} not found`);

  const bf = db.select().from(battlefields).where(eq(battlefields.id, mission.battlefieldId)).get();
  if (!bf) throw new Error(`productionMergeFn: battlefield not found`);

  // Load gate manifest from battlefield
  const emptyManifest: GateManifest = { build: null, test: null, lint: null, typecheck: null };
  let manifest: GateManifest = emptyManifest;
  if (bf.gateManifest) {
    try {
      manifest = { ...emptyManifest, ...JSON.parse(bf.gateManifest) as Partial<GateManifest> };
    } catch {
      manifest = emptyManifest;
    }
  }

  // targetHeadAtStart is captured by the mission runner at worktree creation
  // and threaded through MergeOpts. Capturing it here (at merge time) would
  // always equal currentTarget → advance-detection no-op → parallel missions
  // fail with "cannot fast-forward".
  const mergeResult = await runMerge({
    battlefieldId: bf.id,
    repoPath: opts.repoPath,
    targetBranch: opts.targetBranch,
    sourceBranch: opts.sourceBranch,
    targetHeadAtStart: opts.targetHeadAtStart,
    manifest,
    worktreePath: opts.worktreePath,
    briefing: mission.briefing,
    debrief: mission.debrief ?? undefined,
  });

  return {
    status: mergeResult.status === 'accomplished' ? 'clean' : 'failed',
    reason: mergeResult.reason ? String(mergeResult.reason) : undefined,
    detail: mergeResult.detail,
  };
}

// ---------------------------------------------------------------------------
// Overseer classifier (fast-path) — optional, uses spawnClaudeOneShot
// ---------------------------------------------------------------------------

function makeOverseerClassifier(): ClassifierDeps['overseerClassify'] {
  return async (ctx) => {
    // ExitContext doesn't carry battlefieldId — use process.cwd() as a safe fallback.
    const cwd = process.cwd();

    const overseerAsset = await getOverseerAsset();
    const prompt = buildOverseerClassificationPrompt({
      exitCode: ctx.exitCode ?? 0,
      rawStderr: ctx.stderr,
      stdoutTail: '',
    });

    const result = await spawnClaudeOneShot({
      missionId: 'classifier',
      cwd,
      briefing: prompt,
      asset: overseerAsset,
      rulesOfEngagement: '',
      hardTimeoutMs: 60_000,
    });

    try {
      const parsed = result.json as { category?: string; reasoning?: string };
      const raw = parsed.category ?? '';
      const validCategories = ['INFRASTRUCTURE', 'AGENT_FAILURE', 'NEEDS_COMMANDER'] as const;
      const category = (validCategories as readonly string[]).includes(raw)
        ? (raw as typeof validCategories[number])
        : 'NEEDS_COMMANDER';
      return { category, reasoning: parsed.reasoning ?? '' };
    } catch {
      // ignore
    }
    return { category: 'NEEDS_COMMANDER', reasoning: 'classifier produced non-structured response' };
  };
}

// ---------------------------------------------------------------------------
// buildProductionDeps — main entry point
// ---------------------------------------------------------------------------

export function buildProductionDeps(
  _io: SocketIOServer,
): Omit<MissionRunnerDeps, 'onPidAssigned'> {
  // io is available for future use (e.g., emitting real-time gate results)
  void _io;

  return {
    spawnAsset: makeProductionSpawnAsset(),
    runGatesFn: runGates,
    // Empty fallback manifest — overridden per-mission in productionMergeFn.
    // null commands cause runGates to skip those gates.
    gateManifest: { build: null, test: null, lint: null, typecheck: null },
    classifyExitFn: classifyExit,
    worktree: {
      create: createMissionWorktree,
      reset: resetWorktreeToHead,
      rebase: rebaseOntoTarget,
      sweep: autoCommitSweep,
      remove: removeMissionWorktree,
    },
    overseerConsult: productionOverseerConsult,
    mergeFn: productionMergeFn,
    now: () => Date.now(),
    overseerClassifier: makeOverseerClassifier(),
  };
}
