import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { eq, and, inArray } from 'drizzle-orm';
import { Server as SocketIOServer } from 'socket.io';
import { getDatabase } from '@/lib/db/index';
import { campaigns, phases, missions, battlefields } from '@/lib/db/schema';
import { config } from '@/lib/config';
import type { Mission } from '@/types';

// Terminal statuses — a mission in one of these won't change further
const TERMINAL_STATUSES = ['accomplished', 'compromised', 'abandoned'] as const;

/**
 * CampaignExecutor manages the lifecycle of a running campaign:
 * sequential phase progression with parallel mission execution,
 * dependsOn enforcement, AI-generated phase debriefs, and
 * Commander pause/resume/skip controls.
 */
export class CampaignExecutor {
  private campaignId: string;
  private io: SocketIOServer;

  constructor(campaignId: string, io: SocketIOServer) {
    this.campaignId = campaignId;
    this.io = io;
  }

  // ---------------------------------------------------------------------------
  // Public: start
  // ---------------------------------------------------------------------------

  /**
   * Start a campaign that has been set to `active`.
   * Validates the campaign is active, finds the current phase, and begins execution.
   */
  async start(): Promise<void> {
    const db = getDatabase();
    const campaign = db.select().from(campaigns)
      .where(eq(campaigns.id, this.campaignId)).get();

    if (!campaign) {
      throw new Error(`Campaign ${this.campaignId} not found`);
    }
    if (campaign.status !== 'active') {
      throw new Error(`Campaign ${this.campaignId} is not active (status: ${campaign.status})`);
    }

    // Find the current phase
    const currentPhase = db.select().from(phases)
      .where(and(
        eq(phases.campaignId, this.campaignId),
        eq(phases.phaseNumber, campaign.currentPhase ?? 1),
      )).get();

    if (!currentPhase) {
      // No phases — mark accomplished immediately
      db.update(campaigns).set({
        status: 'accomplished',
        updatedAt: Date.now(),
      }).where(eq(campaigns.id, this.campaignId)).run();
      this.emitCampaignStatus('accomplished');
      console.log(`[Campaign] ${this.campaignId} — no phases found. Marked accomplished.`);
      return;
    }

    await this.startPhase(currentPhase.id);
  }

  // ---------------------------------------------------------------------------
  // Public: resume
  // ---------------------------------------------------------------------------

  /**
   * Resume a paused campaign after Commander has taken corrective action
   * (e.g., redeployed failed missions).
   */
  async resume(): Promise<void> {
    const db = getDatabase();
    const campaign = db.select().from(campaigns)
      .where(eq(campaigns.id, this.campaignId)).get();

    if (!campaign) {
      throw new Error(`Campaign ${this.campaignId} not found`);
    }

    // Set active
    db.update(campaigns).set({
      status: 'active',
      updatedAt: Date.now(),
    }).where(eq(campaigns.id, this.campaignId)).run();
    this.emitCampaignStatus('active');

    // Get current phase
    const currentPhase = db.select().from(phases)
      .where(and(
        eq(phases.campaignId, this.campaignId),
        eq(phases.phaseNumber, campaign.currentPhase ?? 1),
      )).get();

    if (!currentPhase) {
      console.log(`[Campaign] ${this.campaignId} — no current phase found on resume.`);
      return;
    }

    // Get all missions in this phase
    const phaseMissions = db.select().from(missions)
      .where(eq(missions.phaseId, currentPhase.id)).all();

    // Guard: if all missions terminal and any compromised, re-pause (Commander hasn't fixed it)
    const allTerminal = phaseMissions.every(m =>
      TERMINAL_STATUSES.includes(m.status as typeof TERMINAL_STATUSES[number]),
    );
    if (allTerminal) {
      const hasCompromised = phaseMissions.some(m => m.status === 'compromised');
      if (hasCompromised) {
        // Re-pause — infinite loop guard
        db.update(campaigns).set({
          status: 'paused',
          updatedAt: Date.now(),
        }).where(eq(campaigns.id, this.campaignId)).run();
        this.emitCampaignStatus('paused');
        console.log(`[Campaign] ${this.campaignId} — all missions terminal with compromised. Re-paused.`);
        return;
      }
      // All terminal, none compromised — phase is complete
      await this.onPhaseComplete(currentPhase.id);
      return;
    }

    // Re-queue any queued missions
    const queuedMissions = phaseMissions.filter(m => m.status === 'queued');
    for (const m of queuedMissions) {
      globalThis.orchestrator?.onMissionQueued(m.id);
    }

    // Check if any standby missions can be unblocked
    const standbyMissions = phaseMissions.filter(m => m.status === 'standby');
    if (standbyMissions.length > 0) {
      await this.checkDependencies(currentPhase.id);
    }
  }

  // ---------------------------------------------------------------------------
  // Public: skipAndContinue
  // ---------------------------------------------------------------------------

  /**
   * Skip failed missions and continue to the next phase.
   * Marks compromised → abandoned, cascades to standby missions with broken deps.
   */
  async skipAndContinue(): Promise<void> {
    const db = getDatabase();
    const campaign = db.select().from(campaigns)
      .where(eq(campaigns.id, this.campaignId)).get();

    if (!campaign) {
      throw new Error(`Campaign ${this.campaignId} not found`);
    }

    const currentPhase = db.select().from(phases)
      .where(and(
        eq(phases.campaignId, this.campaignId),
        eq(phases.phaseNumber, campaign.currentPhase ?? 1),
      )).get();

    if (!currentPhase) {
      console.log(`[Campaign] ${this.campaignId} — no current phase for skipAndContinue.`);
      return;
    }

    // Step 1: Mark all compromised missions as abandoned
    const compromisedMissions = db.select().from(missions)
      .where(and(
        eq(missions.phaseId, currentPhase.id),
        eq(missions.status, 'compromised'),
      )).all();

    const abandonedTitles = new Set<string>();
    for (const m of compromisedMissions) {
      db.update(missions).set({
        status: 'abandoned',
        updatedAt: Date.now(),
        debrief: (m.debrief || '') + '\n\nAbandoned by Commander (skip & continue).',
      }).where(eq(missions.id, m.id)).run();
      this.emitMissionStatus(m.id, 'abandoned');
      abandonedTitles.add(m.title);
    }

    // Step 2: Cascade — find standby missions whose deps include any abandoned title
    // Repeat until stable (no more cascades)
    let cascaded = true;
    while (cascaded) {
      cascaded = false;
      const standbyMissions = db.select().from(missions)
        .where(and(
          eq(missions.phaseId, currentPhase.id),
          eq(missions.status, 'standby'),
        )).all();

      for (const m of standbyMissions) {
        const deps = parseDependsOn(m.dependsOn);
        if (deps.length === 0) continue;

        const hasBrokenDep = deps.some(dep => abandonedTitles.has(dep));
        if (hasBrokenDep) {
          db.update(missions).set({
            status: 'abandoned',
            updatedAt: Date.now(),
            debrief: 'Abandoned: dependency was skipped by Commander.',
          }).where(eq(missions.id, m.id)).run();
          this.emitMissionStatus(m.id, 'abandoned');
          abandonedTitles.add(m.title);
          cascaded = true;
        }
      }
    }

    // Step 3: Set campaign active
    db.update(campaigns).set({
      status: 'active',
      updatedAt: Date.now(),
    }).where(eq(campaigns.id, this.campaignId)).run();
    this.emitCampaignStatus('active');

    // Step 4: Re-evaluate — now all missions should be terminal (accomplished or abandoned)
    await this.onPhaseComplete(currentPhase.id);
  }

  // ---------------------------------------------------------------------------
  // Public: onCampaignMissionComplete
  // ---------------------------------------------------------------------------

  /**
   * Called by the orchestrator when a campaign mission reaches a terminal state.
   */
  async onCampaignMissionComplete(missionId: string): Promise<void> {
    const db = getDatabase();
    const mission = db.select().from(missions)
      .where(eq(missions.id, missionId)).get();

    if (!mission || !mission.phaseId) {
      console.log(`[Campaign] Mission ${missionId} not found or has no phase.`);
      return;
    }

    // Emit mission status update
    this.emitMissionStatus(missionId, mission.status || 'abandoned');

    // If accomplished, check if we can unblock dependent missions
    if (mission.status === 'accomplished') {
      await this.checkDependencies(mission.phaseId);
    }

    // Check if ALL missions in the phase are terminal
    const phaseMissions = db.select().from(missions)
      .where(eq(missions.phaseId, mission.phaseId)).all();

    const allTerminal = phaseMissions.every(m =>
      TERMINAL_STATUSES.includes(m.status as typeof TERMINAL_STATUSES[number]),
    );

    if (allTerminal) {
      await this.onPhaseComplete(mission.phaseId);
    }
  }

  // ---------------------------------------------------------------------------
  // Private: startPhase
  // ---------------------------------------------------------------------------

  /**
   * Begin executing a phase: set active, queue missions without dependencies.
   */
  private async startPhase(phaseId: string): Promise<void> {
    const db = getDatabase();

    // Get the phase for its phaseNumber
    const phase = db.select().from(phases)
      .where(eq(phases.id, phaseId)).get();

    if (!phase) {
      throw new Error(`Phase ${phaseId} not found`);
    }

    // Set phase active
    db.update(phases).set({
      status: 'active',
    }).where(eq(phases.id, phaseId)).run();
    this.emitPhaseStatus(phaseId, phase.phaseNumber, 'active');

    console.log(`[Campaign] ${this.campaignId} — Phase ${phase.phaseNumber} "${phase.name}" starting.`);

    // Get all missions in this phase
    const phaseMissions = db.select().from(missions)
      .where(eq(missions.phaseId, phaseId)).all();

    // Queue missions that have no dependencies
    for (const m of phaseMissions) {
      const deps = parseDependsOn(m.dependsOn);
      if (deps.length === 0) {
        // No dependencies — queue immediately
        db.update(missions).set({
          status: 'queued',
          updatedAt: Date.now(),
        }).where(eq(missions.id, m.id)).run();
        this.emitMissionStatus(m.id, 'queued');
        globalThis.orchestrator?.onMissionQueued(m.id);
      }
      // Missions with dependencies stay in standby — checkDependencies will handle them
    }
  }

  // ---------------------------------------------------------------------------
  // Private: checkDependencies
  // ---------------------------------------------------------------------------

  /**
   * Find standby missions in a phase whose dependencies are all accomplished,
   * and queue them.
   */
  private async checkDependencies(phaseId: string): Promise<void> {
    const db = getDatabase();

    // Get all missions in this phase
    const phaseMissions = db.select().from(missions)
      .where(eq(missions.phaseId, phaseId)).all();

    // Build set of accomplished mission titles
    const accomplishedTitles = new Set(
      phaseMissions
        .filter(m => m.status === 'accomplished')
        .map(m => m.title),
    );

    // Find standby missions whose deps are all satisfied
    const standbyMissions = phaseMissions.filter(m => m.status === 'standby');

    for (const m of standbyMissions) {
      const deps = parseDependsOn(m.dependsOn);
      if (deps.length === 0) continue; // Shouldn't be standby with no deps, but guard

      const allSatisfied = deps.every(dep => accomplishedTitles.has(dep));
      if (allSatisfied) {
        db.update(missions).set({
          status: 'queued',
          updatedAt: Date.now(),
        }).where(eq(missions.id, m.id)).run();
        this.emitMissionStatus(m.id, 'queued');
        globalThis.orchestrator?.onMissionQueued(m.id);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private: onPhaseComplete
  // ---------------------------------------------------------------------------

  /**
   * Called when all missions in a phase are terminal.
   * If any compromised → pause campaign.
   * If all accomplished (or accomplished+abandoned via skip) → debrief + advance.
   */
  private async onPhaseComplete(phaseId: string): Promise<void> {
    const db = getDatabase();

    const phaseMissions = db.select().from(missions)
      .where(eq(missions.phaseId, phaseId)).all();

    const phase = db.select().from(phases)
      .where(eq(phases.id, phaseId)).get();

    if (!phase) {
      console.error(`[Campaign] Phase ${phaseId} not found in onPhaseComplete.`);
      return;
    }

    const hasCompromised = phaseMissions.some(m => m.status === 'compromised');

    if (hasCompromised) {
      // Pause campaign — awaiting Commander orders
      db.update(phases).set({ status: 'compromised' })
        .where(eq(phases.id, phaseId)).run();
      this.emitPhaseStatus(phaseId, phase.phaseNumber, 'compromised');

      db.update(campaigns).set({
        status: 'paused',
        updatedAt: Date.now(),
      }).where(eq(campaigns.id, this.campaignId)).run();
      this.emitCampaignStatus('paused');

      console.log(`[Campaign] ${this.campaignId} — Phase ${phase.phaseNumber} compromised. Campaign paused. Awaiting Commander orders.`);
      return;
    }

    // All accomplished (or accomplished + abandoned via skip) — phase secured
    // Compute phase stats
    const totalTokens = phaseMissions.reduce(
      (sum, m) => sum + (m.costInput || 0) + (m.costOutput || 0) + (m.costCacheHit || 0),
      0,
    );
    const phaseDuration = phaseMissions.reduce(
      (sum, m) => sum + (m.durationMs || 0),
      0,
    );

    db.update(phases).set({
      status: 'secured',
      totalTokens,
      durationMs: phaseDuration,
    }).where(eq(phases.id, phaseId)).run();
    this.emitPhaseStatus(phaseId, phase.phaseNumber, 'secured');

    console.log(`[Campaign] ${this.campaignId} — Phase ${phase.phaseNumber} secured.`);

    // Fire-and-forget: generate debrief then advance
    // Don't block — emit secured immediately, debrief generation may take 15-30s
    this.generateAndAdvance(phaseId).catch(err => {
      console.error('[Campaign] Phase advance failed:', err);
    });
  }

  // ---------------------------------------------------------------------------
  // Private: generateAndAdvance
  // ---------------------------------------------------------------------------

  /**
   * Async wrapper: generate phase debrief then advance to next phase.
   * Called fire-and-forget from onPhaseComplete so event handlers aren't blocked.
   */
  private async generateAndAdvance(phaseId: string): Promise<void> {
    await this.generatePhaseDebrief(phaseId);

    // Emit debrief event
    const db = getDatabase();
    const phase = db.select().from(phases)
      .where(eq(phases.id, phaseId)).get();

    if (phase?.debrief) {
      this.io.to(`campaign:${this.campaignId}`).emit('campaign:phase-debrief', {
        campaignId: this.campaignId,
        phaseId,
        debrief: phase.debrief,
      });
    }

    await this.advanceToNextPhase();
  }

  // ---------------------------------------------------------------------------
  // Private: generatePhaseDebrief
  // ---------------------------------------------------------------------------

  /**
   * Spawn Claude Code with --print to generate a phase debrief from mission debriefs.
   * On failure, falls back to concatenated mission debriefs.
   */
  private async generatePhaseDebrief(phaseId: string): Promise<void> {
    const db = getDatabase();

    const phase = db.select().from(phases)
      .where(eq(phases.id, phaseId)).get();
    if (!phase) return;

    const phaseMissions = db.select().from(missions)
      .where(eq(missions.phaseId, phaseId)).all();

    const campaign = db.select().from(campaigns)
      .where(eq(campaigns.id, this.campaignId)).get();
    if (!campaign) return;

    const battlefield = db.select().from(battlefields)
      .where(eq(battlefields.id, campaign.battlefieldId)).get();
    if (!battlefield) return;

    // Count total phases for context
    const allPhases = db.select().from(phases)
      .where(eq(phases.campaignId, this.campaignId)).all();
    const totalPhases = allPhases.length;

    // Build CLAUDE.md content
    let claudeMdContent = '';
    if (battlefield.claudeMdPath) {
      try {
        claudeMdContent = fs.readFileSync(battlefield.claudeMdPath, 'utf-8');
      } catch { /* skip */ }
    }

    // Build mission debriefs section
    const missionDebriefLines = phaseMissions.map(m =>
      `**${m.title}** (${m.status}):\n${m.debrief || 'No debrief available.'}`,
    ).join('\n\n');

    // Build prompt
    const promptParts = [
      claudeMdContent,
      '---',
      '',
      '## Phase Debrief Generation',
      '',
      `**Operation**: ${campaign.name}`,
      `**Phase**: ${phase.name} (${phase.phaseNumber} of ${totalPhases})`,
      '',
      '### Mission Debriefs',
      '',
      missionDebriefLines,
      '',
      '### Orders',
      'Produce a concise debrief addressed to "Commander":',
      '1. What was accomplished.',
      '2. Issues or partial failures.',
      '3. Readiness for next phase.',
      '4. Recommended adjustments.',
      '',
      'Under 300 words. Military briefing tone — factual, precise, actionable.',
    ].join('\n');

    // Attempt to generate via Claude Code
    try {
      const debrief = await this.runClaudeForDebrief(promptParts, battlefield.repoPath);
      db.update(phases).set({ debrief })
        .where(eq(phases.id, phaseId)).run();
      console.log(`[Campaign] ${this.campaignId} — Phase ${phase.phaseNumber} debrief generated.`);
    } catch (err) {
      // Fallback: concatenated mission debriefs
      console.error(`[Campaign] Phase debrief generation failed, using fallback:`, err);
      const fallback = [
        `PHASE DEBRIEF — ${phase.name} (Fallback — AI generation failed)`,
        '',
        ...phaseMissions.map(m =>
          `### ${m.title} (${m.status})\n${m.debrief || 'No debrief available.'}`,
        ),
      ].join('\n\n');

      db.update(phases).set({ debrief: fallback })
        .where(eq(phases.id, phaseId)).run();
    }
  }

  /**
   * Spawn Claude Code in --print mode with a temp file prompt.
   * Returns the stdout output.
   */
  private runClaudeForDebrief(prompt: string, cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const tmpFile = path.join(os.tmpdir(), `devroom-debrief-${Date.now()}.txt`);
      fs.writeFileSync(tmpFile, prompt, 'utf-8');

      const proc = spawn(config.claudePath, [
        '--print',
        '--dangerously-skip-permissions',
        '--max-turns', '5',
        '--prompt-file', tmpFile,
      ], { cwd });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }

        if (code === 0 && stdout.trim()) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Claude debrief exited with code ${code}. Stderr: ${stderr.slice(0, 500)}`));
        }
      });

      proc.on('error', (err) => {
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
        reject(err);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Private: advanceToNextPhase
  // ---------------------------------------------------------------------------

  /**
   * Increment currentPhase and start the next phase, or mark campaign accomplished.
   */
  private async advanceToNextPhase(): Promise<void> {
    const db = getDatabase();

    const campaign = db.select().from(campaigns)
      .where(eq(campaigns.id, this.campaignId)).get();
    if (!campaign) return;

    const nextPhaseNumber = (campaign.currentPhase ?? 1) + 1;

    // Check if next phase exists
    const nextPhase = db.select().from(phases)
      .where(and(
        eq(phases.campaignId, this.campaignId),
        eq(phases.phaseNumber, nextPhaseNumber),
      )).get();

    if (!nextPhase) {
      // No more phases — campaign accomplished
      db.update(campaigns).set({
        status: 'accomplished',
        updatedAt: Date.now(),
      }).where(eq(campaigns.id, this.campaignId)).run();
      this.emitCampaignStatus('accomplished');
      console.log(`[Campaign] ${this.campaignId} — Campaign accomplished. All phases secured.`);
      return;
    }

    // Update currentPhase and start next
    db.update(campaigns).set({
      currentPhase: nextPhaseNumber,
      updatedAt: Date.now(),
    }).where(eq(campaigns.id, this.campaignId)).run();

    console.log(`[Campaign] ${this.campaignId} — Advancing to Phase ${nextPhaseNumber}.`);
    await this.startPhase(nextPhase.id);
  }

  // ---------------------------------------------------------------------------
  // Emit helpers
  // ---------------------------------------------------------------------------

  private emitCampaignStatus(status: string): void {
    this.io.to(`campaign:${this.campaignId}`).emit('campaign:status', {
      campaignId: this.campaignId,
      status,
      timestamp: Date.now(),
    });
    // Also emit to HQ activity feed
    this.io.to('hq:activity').emit('activity:event', {
      type: 'campaign:status',
      campaignId: this.campaignId,
      status,
      timestamp: Date.now(),
    });
  }

  private emitPhaseStatus(phaseId: string, phaseNumber: number, status: string): void {
    this.io.to(`campaign:${this.campaignId}`).emit('campaign:phase-status', {
      campaignId: this.campaignId,
      phaseId,
      phaseNumber,
      status,
      timestamp: Date.now(),
    });
  }

  private emitMissionStatus(missionId: string, status: string): void {
    this.io.to(`campaign:${this.campaignId}`).emit('campaign:mission-status', {
      campaignId: this.campaignId,
      missionId,
      status,
      timestamp: Date.now(),
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the dependsOn JSON string into an array of mission title strings.
 * Returns empty array on null, empty, or invalid JSON.
 */
function parseDependsOn(dependsOn: string | null): string[] {
  if (!dependsOn) return [];
  try {
    const parsed = JSON.parse(dependsOn);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}
