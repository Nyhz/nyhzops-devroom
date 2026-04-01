import fs from 'fs';
import { eq, and, isNull } from 'drizzle-orm';
import { Server as SocketIOServer } from 'socket.io';
import { getDatabase } from '@/lib/db/index';
import { campaigns, phases, missions, battlefields } from '@/lib/db/schema';
import { runClaudePrint } from '@/lib/process/claude-print';
import { getSystemAsset } from '@/lib/orchestrator/system-asset';
import { buildAssetCliArgs } from './asset-cli';
import { escalate } from '@/lib/overseer/escalation';
import { handlePhaseFailure } from '@/lib/overseer/phase-failure-handler';
import { storeOverseerLog } from '@/lib/overseer/overseer-db';
import { extractAndSaveSuggestions } from '@/actions/follow-up';
import { emitStatusChange } from '@/lib/socket/emit';
import { safeQueueMission } from '@/lib/orchestrator/safe-queue';
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
      emitStatusChange('campaign', this.campaignId, 'accomplished');
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
    emitStatusChange('campaign', this.campaignId, 'active');

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
        // Re-compromise — infinite loop guard
        db.update(campaigns).set({
          status: 'compromised',
          updatedAt: Date.now(),
        }).where(eq(campaigns.id, this.campaignId)).run();
        emitStatusChange('campaign', this.campaignId, 'compromised');
        console.log(`[Campaign] ${this.campaignId} — all missions terminal with compromised. Re-compromised.`);
        return;
      }
      // All terminal, none compromised — phase is complete
      await this.onPhaseComplete(currentPhase.id);
      return;
    }

    // Re-queue any queued missions
    const queuedMissions = phaseMissions.filter(m => m.status === 'queued');
    for (const m of queuedMissions) {
      safeQueueMission(m.id);
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
      emitStatusChange('mission', m.id, 'abandoned');
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
          emitStatusChange('mission', m.id, 'abandoned');
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
    emitStatusChange('campaign', this.campaignId, 'active');

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
    emitStatusChange('mission', missionId, mission.status || 'abandoned');

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

    // Drain queue — newly unblocked or phase-advanced missions need pickup
    globalThis.orchestrator?.drainQueue();
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
    emitStatusChange('phase', phaseId, 'active');

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
        emitStatusChange('mission', m.id, 'queued');
        safeQueueMission(m.id);
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
        emitStatusChange('mission', m.id, 'queued');
        safeQueueMission(m.id);
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

    // Atomic claim — only one concurrent caller can proceed.
    // Uses UPDATE WHERE completingAt IS NULL so exactly one handler wins.
    const claimResult = db.update(phases)
      .set({ completingAt: Date.now() })
      .where(and(
        eq(phases.id, phaseId),
        isNull(phases.completingAt),
      ))
      .run();

    if (claimResult.changes === 0) {
      console.log(`[Campaign] Phase ${phaseId} already being completed by another handler. Skipping.`);
      return;
    }

    const phaseMissions = db.select().from(missions)
      .where(eq(missions.phaseId, phaseId)).all();

    const phase = db.select().from(phases)
      .where(eq(phases.id, phaseId)).get();

    if (!phase) {
      console.error(`[Campaign] Phase ${phaseId} not found in onPhaseComplete.`);
      return;
    }

    const compromisedMissions = phaseMissions.filter(m => m.status === 'compromised');
    const accomplishedMissions = phaseMissions.filter(m => m.status === 'accomplished');
    const hasCompromised = compromisedMissions.length > 0;

    if (hasCompromised) {
      // Get campaign + battlefield for context
      const campaign = db.select().from(campaigns)
        .where(eq(campaigns.id, this.campaignId)).get();

      if (!campaign) {
        console.error(`[Campaign] Campaign ${this.campaignId} not found in onPhaseComplete.`);
        return;
      }

      // Count total phases for Overseer context
      const allPhases = db.select().from(phases)
        .where(eq(phases.campaignId, this.campaignId)).all();
      const totalPhases = allPhases.length;

      // Read CLAUDE.md for Overseer context
      let claudeMd: string | null = null;
      const battlefield = db.select().from(battlefields)
        .where(eq(battlefields.id, campaign.battlefieldId)).get();
      if (battlefield?.claudeMdPath) {
        try {
          claudeMd = fs.readFileSync(battlefield.claudeMdPath, 'utf-8');
        } catch { /* skip */ }
      }

      // Let Overseer decide before pausing
      console.log(`[Campaign] ${this.campaignId} — Phase ${phase.phaseNumber} has ${compromisedMissions.length} compromised mission(s). Consulting Overseer...`);

      const decision = await handlePhaseFailure({
        campaign,
        phase,
        compromisedMissions: compromisedMissions as Mission[],
        accomplishedMissions: accomplishedMissions as Mission[],
        claudeMd,
        totalPhases,
      });

      // Log the decision
      storeOverseerLog({
        missionId: compromisedMissions[0]?.id || '',
        battlefieldId: campaign.battlefieldId,
        campaignId: campaign.id,
        question: `[PHASE_FAILURE] Phase ${phase.name}: ${compromisedMissions.length} mission(s) compromised`,
        answer: `Decision: ${decision.decision}. ${decision.reasoning}`,
        reasoning: decision.reasoning,
        confidence: decision.decision === 'escalate' ? 'low' : 'medium',
        escalated: decision.decision === 'escalate' ? 1 : 0,
      });

      if (decision.decision === 'retry') {
        console.log(`[Campaign] ${this.campaignId} — Overseer decided to retry ${compromisedMissions.length} mission(s).`);

        // Retry failed missions — reset directly instead of calling Server Action
        // (Server Actions use revalidatePath which fails outside request context)
        const now = Date.now();
        for (const m of compromisedMissions) {
          const newBriefing = decision.retryBriefings?.[m.id] || m.briefing;
          db.update(missions).set({
            briefing: newBriefing,
            status: 'queued',
            sessionId: null,
            debrief: null,
            reviewAttempts: 0,
            completedAt: null,
            startedAt: null,
            updatedAt: now,
          }).where(eq(missions.id, m.id)).run();
          safeQueueMission(m.id);
        }
        // Don't pause — redeployed missions will run and onCampaignMissionComplete will re-evaluate
        return;

      } else if (decision.decision === 'skip') {
        console.log(`[Campaign] ${this.campaignId} — Overseer decided to skip failed missions and continue.`);
        // Overseer says skip — use existing skipAndContinue logic
        await this.skipAndContinue();
        return;

      } else {
        // Escalate — pause the campaign (existing behavior)
        db.update(phases).set({ status: 'compromised' })
          .where(eq(phases.id, phaseId)).run();
        emitStatusChange('phase', phaseId, 'compromised');

        db.update(campaigns).set({
          status: 'compromised',
          updatedAt: Date.now(),
        }).where(eq(campaigns.id, this.campaignId)).run();
        emitStatusChange('campaign', this.campaignId, 'compromised');

        console.log(`[Campaign] ${this.campaignId} — Overseer escalated. Phase ${phase.phaseNumber} compromised. Campaign compromised. Awaiting Commander orders.`);

        escalate({
          level: 'critical',
          title: `Campaign Compromised: ${campaign.name}`,
          detail: `Phase ${phase.name} compromised. ${compromisedMissions.length} mission(s) failed. Overseer: ${decision.reasoning}`,
          entityType: 'campaign',
          entityId: this.campaignId,
          battlefieldId: campaign.battlefieldId,
          actions: [
            { label: 'RESUME', handler: 'resume' },
            { label: 'SKIP & CONTINUE', handler: 'skip' },
            { label: 'ABANDON', handler: 'abort' },
          ],
        }).catch((err) => {
          console.error('[Campaign] Escalation failed:', err);
        });

        return;
      }
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
    emitStatusChange('phase', phaseId, 'secured');

    console.log(`[Campaign] ${this.campaignId} — Phase ${phase.phaseNumber} secured.`);

    // Generate debrief then advance — non-blocking but with error recovery
    this.generateAndAdvance(phaseId).catch(err => {
      console.error('[Campaign] Phase advance failed:', err);
      this.stallCampaign(phaseId, `Phase debrief generation failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  // ---------------------------------------------------------------------------
  // Private: generateAndAdvance
  // ---------------------------------------------------------------------------

  /** Retry wrapper for stalled campaigns — called from server actions. */
  async retryGenerateAndAdvance(phaseId: string): Promise<void> {
    return this.generateAndAdvance(phaseId);
  }

  /** Retry wrapper for skip-debrief — called from server actions. */
  async retryAdvanceToNextPhase(): Promise<void> {
    return this.advanceToNextPhase();
  }

  /**
   * Async wrapper: generate phase debrief then advance to next phase.
   * Called from onPhaseComplete — stalls campaign on failure so Commander can intervene.
   */
  private async generateAndAdvance(phaseId: string): Promise<void> {
    try {
      await this.generatePhaseDebrief(phaseId);
    } catch (err) {
      this.stallCampaign(phaseId, `Phase debrief generation failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

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

    try {
      await this.advanceToNextPhase();
    } catch (err) {
      this.stallCampaign(phaseId, `Phase advancement failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Stall the campaign — pause with a reason so the UI can show recovery options.
   */
  private stallCampaign(phaseId: string, reason: string): void {
    const db = getDatabase();
    db.update(campaigns).set({
      status: 'paused',
      stallReason: reason,
      stalledPhaseId: phaseId,
      updatedAt: Date.now(),
    }).where(eq(campaigns.id, this.campaignId)).run();

    emitStatusChange('campaign', this.campaignId, 'paused');

    this.io.to(`campaign:${this.campaignId}`).emit('campaign:stalled', {
      campaignId: this.campaignId,
      phaseId,
      reason,
    });

    console.log(`[Campaign] ${this.campaignId} — STALLED: ${reason}`);

    escalate({
      level: 'warning',
      title: `Campaign Stalled: ${this.campaignId}`,
      detail: reason,
      entityType: 'campaign',
      entityId: this.campaignId,
    }).catch(err => {
      console.error('[Campaign] Stall escalation failed:', err);
    });
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
      '5. Recommended next actions for the Commander (use heading: ## Recommended Next Actions)',
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

  // ---------------------------------------------------------------------------
  // Private: generateCampaignDebrief
  // ---------------------------------------------------------------------------

  /**
   * Generate a campaign-level debrief that synthesizes all phase debriefs,
   * then extract follow-up suggestions from it.
   * Called after the last phase completes, before marking the campaign accomplished.
   */
  private async generateCampaignDebrief(): Promise<void> {
    const db = getDatabase();

    const campaign = db.select().from(campaigns)
      .where(eq(campaigns.id, this.campaignId)).get();
    if (!campaign) return;

    const battlefield = db.select().from(battlefields)
      .where(eq(battlefields.id, campaign.battlefieldId)).get();
    if (!battlefield) return;

    // Gather all phase debriefs ordered by phaseNumber
    const allPhases = db.select().from(phases)
      .where(eq(phases.campaignId, this.campaignId)).all()
      .sort((a, b) => a.phaseNumber - b.phaseNumber);

    // Build CLAUDE.md content
    let claudeMdContent = '';
    if (battlefield.claudeMdPath) {
      try {
        claudeMdContent = fs.readFileSync(battlefield.claudeMdPath, 'utf-8');
      } catch { /* skip */ }
    }

    // Build phase debriefs section
    const phaseDebriefLines = allPhases.map(p =>
      `#### Phase ${p.phaseNumber}: ${p.name}\n${p.debrief || 'No debrief available.'}`,
    ).join('\n\n');

    // Build prompt
    const promptParts = [
      claudeMdContent,
      '---',
      '',
      '## Campaign Debrief Generation',
      '',
      `**Operation**: ${campaign.name}`,
      `**Objective**: ${campaign.objective || 'Not specified'}`,
      `**Phases Completed**: ${allPhases.length}`,
      '',
      '### Phase Debriefs',
      '',
      phaseDebriefLines,
      '',
      '### Orders',
      '',
      'Synthesize these phase debriefs into a comprehensive campaign debrief addressed to "Commander". Include:',
      '1. Overall campaign outcome — was the objective achieved?',
      '2. Key accomplishments across all phases',
      '3. Issues encountered and how they were resolved',
      '4. Lessons learned',
      '5. ## Recommended Next Actions (concrete follow-up tasks as a bullet list)',
      '',
      'Keep under 500 words. Military briefing tone — factual, precise, actionable.',
    ].join('\n');

    let debrief: string;

    try {
      debrief = await this.runClaudeForDebrief(promptParts, battlefield.repoPath);
      console.log(`[Campaign] ${this.campaignId} — Campaign debrief generated.`);
    } catch (err) {
      // Fallback: concatenated phase debriefs
      console.error(`[Campaign] Campaign debrief generation failed, using fallback:`, err);
      debrief = [
        `CAMPAIGN DEBRIEF — ${campaign.name} (Fallback — AI generation failed)`,
        '',
        ...allPhases.map(p =>
          `### Phase ${p.phaseNumber}: ${p.name} (${p.status})\n${p.debrief || 'No debrief available.'}`,
        ),
      ].join('\n\n');
    }

    // Store the campaign debrief
    db.update(campaigns).set({ debrief })
      .where(eq(campaigns.id, this.campaignId)).run();

    // Emit campaign debrief event
    this.io.to(`campaign:${this.campaignId}`).emit('campaign:debrief', {
      campaignId: this.campaignId,
      debrief,
    });

    // Extract and save follow-up suggestions
    try {
      const suggestions = await extractAndSaveSuggestions({
        battlefieldId: campaign.battlefieldId,
        campaignId: this.campaignId,
        debrief,
      });

      if (suggestions.length > 0) {
        this.io.to(`campaign:${this.campaignId}`).emit('campaign:suggestions', {
          campaignId: this.campaignId,
          suggestions,
        });
        console.log(`[Campaign] ${this.campaignId} — ${suggestions.length} follow-up suggestion(s) extracted.`);
      }
    } catch (err) {
      console.error(`[Campaign] Follow-up suggestion extraction failed:`, err);
    }
  }

  /**
   * Spawn Claude Code in --print mode with OVERSEER asset config.
   * Returns the stdout output.
   */
  private runClaudeForDebrief(prompt: string, cwd: string): Promise<string> {
    const overseer = getSystemAsset('OVERSEER');
    const assetArgs = buildAssetCliArgs(overseer);
    const filtered = CampaignExecutor.filterFlag(assetArgs, '--max-turns');

    return runClaudePrint(prompt, {
      maxTurns: 5,
      cwd,
      extraArgs: filtered,
    });
  }

  /**
   * Filter a flag and its value from an args array.
   */
  private static filterFlag(args: string[], flag: string): string[] {
    const result: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === flag) { i++; continue; }
      result.push(args[i]);
    }
    return result;
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
      // No more phases — generate campaign debrief then mark accomplished
      await this.generateCampaignDebrief();

      db.update(campaigns).set({
        status: 'accomplished',
        updatedAt: Date.now(),
      }).where(eq(campaigns.id, this.campaignId)).run();
      emitStatusChange('campaign', this.campaignId, 'accomplished');
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
