import { spawn } from 'child_process';
import { createInterface } from 'readline';
import fs from 'fs';
import path from 'path';
import { eq } from 'drizzle-orm';
import { Server as SocketIOServer } from 'socket.io';
import { getDatabase } from '@/lib/db/index';
import { missions, missionLogs, battlefields, assets, campaigns } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import { config } from '@/lib/config';
import { buildPrompt } from './prompt-builder';
import { StreamParser } from './stream-parser';
import { createWorktree, removeWorktree } from './worktree';
import { askCaptain } from '@/lib/captain/captain';
import { storeCaptainLog, getRecentCaptainLogs } from '@/lib/captain/captain-db';
import { escalate } from '@/lib/captain/escalation';
import { runCaptainReview } from '@/lib/captain/review-handler';
import { getCaptainLogs } from '@/actions/captain';
import type { Mission, StreamResult } from '@/types';
import { checkCliAuth } from './auth-check';
import type { Orchestrator } from './orchestrator';

/** Remove per-mission Claude config isolation dir */
function cleanupMissionHome(missionId: string) {
  try {
    fs.rmSync(`/tmp/claude-config/${missionId}`, { recursive: true, force: true });
  } catch { /* best effort */ }
}

export class RateLimitError extends Error {
  resetsAt: number;
  rateLimitType: string;

  constructor(message: string, resetsAt: number, rateLimitType: string) {
    super(message);
    this.name = 'RateLimitError';
    this.resetsAt = resetsAt;
    this.rateLimitType = rateLimitType;
  }
}

export async function executeMission(
  mission: Mission,
  io: SocketIOServer,
  abortController: AbortController,
): Promise<void> {
  const db = getDatabase();
  const room = `mission:${mission.id}`;
  let streamResult: StreamResult | null = null;
  let rateLimitDetected = false;
  let rateLimitInfo = { resetsAt: 0, rateLimitType: '' };

  // Helper: update mission in DB and emit status
  const updateStatus = (status: string, extra: Record<string, unknown> = {}) => {
    db.update(missions)
      .set({ status, updatedAt: Date.now(), ...extra })
      .where(eq(missions.id, mission.id))
      .run();
    io.to(room).emit('mission:status', { missionId: mission.id, status, timestamp: Date.now() });
    io.to(`battlefield:${mission.battlefieldId}`).emit('mission:status', { missionId: mission.id, status, timestamp: Date.now() });
  };

  // Helper: store a mission log
  const storeLog = (type: string, content: string) => {
    db.insert(missionLogs).values({
      id: generateId(),
      missionId: mission.id,
      timestamp: Date.now(),
      type,
      content,
    }).run();
  };

  // Helper: emit activity event
  const emitActivity = (type: string, detail: string) => {
    const bf = db.select({ codename: battlefields.codename })
      .from(battlefields)
      .where(eq(battlefields.id, mission.battlefieldId))
      .get();
    io.to('hq:activity').emit('activity:event', {
      type,
      battlefieldCodename: bf?.codename || 'UNKNOWN',
      missionTitle: mission.title,
      timestamp: Date.now(),
      detail,
    });
  };

  // Hoist variables so they're accessible in catch block for cleanup
  let stallCheckInterval: NodeJS.Timeout | null = null;
  let workingDirectory: string | null = null;
  let worktreePath: string | null = null;
  let worktreeBranch: string | null = mission.worktreeBranch;
  let battlefieldRef: { repoPath: string; defaultBranch: string | null } | null = null;

  try {
    // Step 1: DEPLOYING
    updateStatus('deploying');
    emitActivity('mission:deploying', `Deploying mission: ${mission.title}`);

    // Ensure campaign is active if this is a campaign mission
    if (mission.campaignId) {
      db.update(campaigns).set({
        status: 'active',
        updatedAt: Date.now(),
      }).where(eq(campaigns.id, mission.campaignId)).run();
    }

    // Pre-flight auth check — verify CLI can authenticate before spending resources
    const authResult = await checkCliAuth();
    if (!authResult.ok) {
      updateStatus('queued');
      storeLog('status', `Auth check failed: ${authResult.error}. Mission re-queued.`);
      emitActivity('mission:auth_failed', `Auth check failed for mission: ${mission.title}. Re-queued.`);

      const orch = globalThis.orchestrator as Orchestrator | undefined;
      if (orch && !orch.paused) {
        orch.pause('CLI authentication lost');
        escalate({
          level: 'critical',
          title: 'CLI Authentication Lost',
          detail: 'Queue paused. All missions held.\nCheck host credential sync and re-login if needed.',
          actions: [
            { label: 'UNPAUSE', handler: 'unpause' },
          ],
        });
      }

      return;
    }

    // Step 2: Build prompt
    const battlefield = db.select().from(battlefields)
      .where(eq(battlefields.id, mission.battlefieldId)).get();
    if (!battlefield) throw new Error(`Battlefield not found: ${mission.battlefieldId}`);
    battlefieldRef = { repoPath: battlefield.repoPath, defaultBranch: battlefield.defaultBranch };

    let asset = null;
    if (mission.assetId) {
      asset = db.select().from(assets)
        .where(eq(assets.id, mission.assetId)).get() || null;
    }

    // Worktree setup (all missions except bootstrap)
    workingDirectory = battlefield.repoPath;

    if (mission.type !== 'bootstrap') {
      // Check if mission already has a worktree (e.g., continued from compromised)
      if (worktreeBranch) {
        // Reuse existing worktree
        const existingPath = path.join(
          battlefield.repoPath, '.worktrees',
          worktreeBranch.replace(/\//g, '-')
        );
        if (fs.existsSync(existingPath)) {
          worktreePath = existingPath;
          workingDirectory = existingPath;
          storeLog('status', `Reusing existing worktree: ${worktreeBranch}`);
        } else {
          // Worktree was cleaned up — create a fresh one
          worktreeBranch = null;
        }
      }

      if (!worktreeBranch) {
        try {
          worktreePath = await createWorktree(battlefield.repoPath, mission, battlefield);
          workingDirectory = worktreePath;
          // Re-read worktreeBranch — createWorktree sets it in the DB internally
          const updated = db.select({ worktreeBranch: missions.worktreeBranch })
            .from(missions).where(eq(missions.id, mission.id)).get();
          worktreeBranch = updated?.worktreeBranch || null;
        } catch (wtErr) {
          console.warn(`[Executor] Worktree creation failed for mission ${mission.id}, falling back to repo root:`, wtErr);
          storeLog('status', `Worktree creation failed: ${wtErr}. Running on repo root.`);
          workingDirectory = battlefield.repoPath;
        }
      }
    }

    let fullPrompt = buildPrompt(mission, battlefield, asset);

    // Workspace context — tell the agent where it's running
    const isWorktree = workingDirectory !== battlefield.repoPath;
    fullPrompt += `\n\n---\n\n## Workspace\n\nYour working directory is \`${workingDirectory}\`.${isWorktree ? `\nYou are operating in a git worktree. All file paths are relative to this directory. Use absolute paths starting with \`${workingDirectory}/\` when reading or writing files.` : ''}\nThe main repository is at \`${battlefield.repoPath}\`.`;

    // Check for captain retry feedback
    const retryAttempts = mission.reviewAttempts ?? 0;
    if (retryAttempts > 0) {
      const captainLogs = await getCaptainLogs({ missionId: mission.id });
      const retryFeedback = captainLogs
        .filter(log => log.question.startsWith('[RETRY_FEEDBACK]'))
        .pop();

      if (retryFeedback) {
        fullPrompt += `\n\n---\n\nCAPTAIN REVIEW FEEDBACK (Retry ${retryAttempts})\n========================================\nThe Captain reviewed your previous work and found these concerns:\n${retryFeedback.answer}\n\nCaptain's reasoning: ${retryFeedback.reasoning}\n\nPlease address these concerns. Your previous session context is preserved.\nYou have access to all changes you made previously.\n\nOriginal briefing:\n${mission.briefing}`;
      }
    }

    // Read CLAUDE.md content for Captain context
    let claudeMdContent: string | null = null;
    if (battlefield.claudeMdPath) {
      try {
        claudeMdContent = fs.readFileSync(battlefield.claudeMdPath, 'utf-8');
      } catch { /* skip */ }
    }

    // Build campaign context string for Captain
    let campaignContextString: string | null = null;
    if (mission.campaignId) {
      // Extract campaign context from the prompt (it's already built in)
      campaignContextString = `Campaign mission for battlefield ${battlefield.codename}. Mission: ${mission.title}`;
    }

    // For continued missions, inject the previous mission's debrief as context
    // (session resume doesn't work across worktrees, so we provide context via prompt)
    if (mission.sessionId) {
      const prevMission = db.select().from(missions)
        .where(eq(missions.sessionId, mission.sessionId))
        .all()
        .filter(m => m.id !== mission.id && m.debrief)
        .pop();
      if (prevMission?.debrief) {
        fullPrompt += `\n\n---\n\n## Previous Mission Context\n\nThis is a continuation of a previous mission. Here is the debrief from the prior run:\n\n${prevMission.debrief}`;
      }
    }

    // Step 3: Spawn Claude Code
    const args = [
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--dangerously-skip-permissions',
      '--max-turns', '100',
      fullPrompt,
    ];

    // Isolate Claude config per mission to prevent concurrent write corruption
    // and session ID collisions. Each mission gets its own HOME.
    // Fresh missions: only auth + settings (no shared sessions).
    // Continued missions: also symlink sessions so they can resume context.
    const missionHome = `/tmp/claude-config/${mission.id}`;
    const missionClaudeDir = path.join(missionHome, '.claude');
    fs.mkdirSync(missionClaudeDir, { recursive: true });
    const realHome = process.env.HOME || '/home/devroom';
    try {
      fs.copyFileSync(path.join(realHome, '.claude.json'), path.join(missionHome, '.claude.json'));
    } catch { /* no .claude.json — fine */ }
    // Copy settings from container HOME
    try {
      fs.copyFileSync(path.join(realHome, '.claude', 'settings.json'), path.join(missionClaudeDir, 'settings.json'));
    } catch { /* skip missing */ }
    // Copy auth credentials from host-synced Keychain extract (Docker volume mount)
    try {
      fs.copyFileSync(config.hostCredentialsPath, path.join(missionClaudeDir, '.credentials.json'));
    } catch { /* no host credentials — auth check will catch this */ }

    const proc = spawn(config.claudePath, args, {
      cwd: workingDirectory,
      signal: abortController.signal,
      env: { ...process.env, HOME: missionHome },
    });

    // Capture stderr — set up BEFORE readline loop so we don't miss output
    let stderrOutput = '';
    proc.stderr?.on('data', (data: Buffer) => {
      stderrOutput += data.toString();
    });

    // Step 4: IN COMBAT
    updateStatus('in_combat', { startedAt: Date.now() });
    emitActivity('mission:in_combat', `Mission in combat: ${mission.title}`);

    // Step 5: Parse stream
    const parser = new StreamParser();

    // Captain stall detection state
    let lastAssistantContent = '';
    let lastActivityTime = Date.now();
    let waitingForInput = false;
    let lastMessageHadToolUse = false;
    let recentOutputBuffer = '';

    parser.onDelta((text) => {
      lastActivityTime = Date.now();
      recentOutputBuffer += text;
      if (recentOutputBuffer.length > 3000) {
        recentOutputBuffer = recentOutputBuffer.slice(-2000);
      }
      io.to(room).emit('mission:log', {
        missionId: mission.id,
        timestamp: Date.now(),
        type: 'log',
        content: text,
      });
    });

    parser.onAssistantTurn((content) => {
      lastActivityTime = Date.now();
      lastAssistantContent = content;
      lastMessageHadToolUse = false;
      storeLog('log', content);
    });

    parser.onToolUse((tool) => {
      lastActivityTime = Date.now();
      lastMessageHadToolUse = true;
      const msg = `Tool: ${tool}`;
      storeLog('log', msg);
      io.to(room).emit('mission:log', {
        missionId: mission.id,
        timestamp: Date.now(),
        type: 'log',
        content: msg + '\n',
      });
    });

    parser.onToolResult((_toolId, result, isError) => {
      lastActivityTime = Date.now();
      if (isError) {
        storeLog('error', result);
      }
    });

    parser.onError((error) => {
      lastActivityTime = Date.now();
      storeLog('error', error);
      io.to(room).emit('mission:log', {
        missionId: mission.id,
        timestamp: Date.now(),
        type: 'error',
        content: error,
      });
    });

    parser.onTokens((usage) => {
      lastActivityTime = Date.now();
      io.to(room).emit('mission:tokens', {
        missionId: mission.id,
        input: usage.inputTokens,
        output: usage.outputTokens,
        cacheHit: usage.cacheReadTokens,
        cacheCreation: usage.cacheCreationTokens,
        costUsd: 0, // Cost only available in final result
      });
    });

    parser.onRateLimit((info) => {
      lastActivityTime = Date.now();
      // Store latest rate limit info on orchestrator
      if (globalThis.orchestrator) {
        globalThis.orchestrator.latestRateLimit = {
          status: info.status,
          resetsAt: info.resetsAt,
          rateLimitType: info.rateLimitType,
          lastUpdated: Date.now(),
        };
      }

      if (info.status !== 'allowed') {
        rateLimitDetected = true;
        rateLimitInfo = { resetsAt: info.resetsAt, rateLimitType: info.rateLimitType };
      }
    });

    parser.onResult((result) => {
      lastActivityTime = Date.now();
      waitingForInput = false;
      streamResult = result;
    });

    // Captain stall detection interval — check every 5 seconds for 15-second silence
    stallCheckInterval = setInterval(async () => {
      if (waitingForInput) return; // Already handling a stall

      const silenceMs = Date.now() - lastActivityTime;

      if (
        silenceMs > 120_000 &&         // 2 minutes of silence — avoids false positives on long thinking
        lastAssistantContent &&         // There was an assistant message
        !lastMessageHadToolUse &&       // It didn't call a tool
        !streamResult                   // No result yet (process still running)
      ) {
        waitingForInput = true;

        try {
          // Get Captain's decision
          const decision = await askCaptain({
            question: lastAssistantContent,
            missionBriefing: mission.briefing,
            claudeMd: claudeMdContent,
            recentOutput: recentOutputBuffer.slice(-2000),
            captainHistory: getRecentCaptainLogs(mission.id, 5),
            campaignContext: campaignContextString || undefined,
          });

          // Store in captain log
          storeCaptainLog({
            missionId: mission.id,
            campaignId: mission.campaignId,
            battlefieldId: mission.battlefieldId,
            question: lastAssistantContent,
            answer: decision.answer,
            reasoning: decision.reasoning,
            confidence: decision.confidence,
            escalated: decision.escalate ? 1 : 0,
          });

          // Show in mission comms
          const captainMsg = `[CAPTAIN] ${decision.answer}\n(confidence: ${decision.confidence})`;
          io.to(room).emit('mission:log', {
            missionId: mission.id,
            timestamp: Date.now(),
            type: 'status',
            content: captainMsg + '\n',
          });
          storeLog('status', captainMsg);

          // Write to agent's stdin
          proc.stdin?.write(decision.answer + '\n');

          // Reset detection
          lastAssistantContent = '';
          lastActivityTime = Date.now();

          // Handle escalation
          if (decision.escalate) {
            const bf = db.select({ codename: battlefields.codename })
              .from(battlefields)
              .where(eq(battlefields.id, mission.battlefieldId))
              .get();
            io.to('hq:activity').emit('activity:event', {
              type: 'captain:escalation',
              battlefieldCodename: bf?.codename || 'UNKNOWN',
              missionTitle: mission.title,
              timestamp: Date.now(),
              detail: `Captain escalation: ${decision.reasoning}`,
            });

            // Send Telegram escalation notification
            escalate({
              level: decision.confidence === 'low' ? 'warning' : 'info',
              title: `Captain Escalation: ${mission.title}`,
              detail: `Q: ${lastAssistantContent.slice(0, 200)}\nA: ${decision.answer}\nReasoning: ${decision.reasoning}`,
              entityType: 'mission',
              entityId: mission.id,
              battlefieldId: mission.battlefieldId,
              actions: [
                { label: 'APPROVE', handler: 'approve' },
                { label: 'RETRY', handler: 'retry' },
                { label: 'ABORT', handler: 'abort' },
              ],
            }).catch((err) => {
              console.error('[Executor] Escalation failed:', err);
            });
          }
        } finally {
          waitingForInput = false;
        }
      }
    }, 5_000);

    // Read stdout line by line
    const rl = createInterface({ input: proc.stdout! });
    for await (const line of rl) {
      parser.feed(line);
    }

    // Clean up stall detection interval
    if (stallCheckInterval) {
      clearInterval(stallCheckInterval);
      stallCheckInterval = null;
    }

    // Wait for process to fully close
    const exitCode = await new Promise<number>((resolve) => {
      proc.on('close', (code) => resolve(code ?? 1));
    });

    // Check for rate limit
    if (rateLimitDetected) {
      updateStatus('queued'); // Reset to queued for retry
      storeLog('status', `Rate limited (${rateLimitInfo.rateLimitType}). Awaiting retry.`);
      throw new RateLimitError(
        `Rate limited: ${rateLimitInfo.rateLimitType}`,
        rateLimitInfo.resetsAt,
        rateLimitInfo.rateLimitType,
      );
    }

    // Step 6: Process complete
    if (streamResult) {
      const r = streamResult as StreamResult;
      const finalStatus = r.isError ? 'compromised' : 'reviewing';

      db.update(missions).set({
        sessionId: r.sessionId,
        debrief: r.result,
        costInput: r.usage.inputTokens,
        costOutput: r.usage.outputTokens,
        costCacheHit: r.usage.cacheReadTokens,
        durationMs: r.durationMs,
        status: finalStatus,
        completedAt: r.isError ? Date.now() : null,
        updatedAt: Date.now(),
      }).where(eq(missions.id, mission.id)).run();

      io.to(room).emit('mission:status', {
        missionId: mission.id, status: finalStatus, timestamp: Date.now(),
      });
      io.to(`battlefield:${mission.battlefieldId}`).emit('mission:status', {
        missionId: mission.id, status: finalStatus, timestamp: Date.now(),
      });
      io.to(room).emit('mission:debrief', {
        missionId: mission.id, debrief: r.result,
      });
      io.to(room).emit('mission:tokens', {
        missionId: mission.id,
        input: r.usage.inputTokens,
        output: r.usage.outputTokens,
        cacheHit: r.usage.cacheReadTokens,
        cacheCreation: r.usage.cacheCreationTokens,
        costUsd: r.totalCostUsd,
      });
      emitActivity(`mission:${finalStatus}`, `Mission ${finalStatus}: ${mission.title}`);

      // Update asset missions completed count (reviewing = work done, pending captain approval)
      if (mission.assetId && finalStatus === 'reviewing') {
        const currentAsset = db.select().from(assets)
          .where(eq(assets.id, mission.assetId)).get();
        if (currentAsset) {
          db.update(assets).set({
            missionsCompleted: (currentAsset.missionsCompleted || 0) + 1,
          }).where(eq(assets.id, mission.assetId)).run();
        }
      }

      // Captain review — async, non-blocking
      // Merge happens AFTER Captain approves (in promoteMission), not here.
      runCaptainReview(mission.id).catch(err => {
        console.error('[Captain] Review handler failed:', err);
      });
    } else {
      // No result message — process exited without proper completion
      const compromisedDebrief = `Process exited with code ${exitCode}. ${stderrOutput ? 'Stderr: ' + stderrOutput.slice(0, 500) : 'No output captured.'}`;
      updateStatus('compromised', {
        completedAt: Date.now(),
        debrief: worktreeBranch
          ? compromisedDebrief + `\nBranch \`${worktreeBranch}\` preserved for inspection.`
          : compromisedDebrief,
      });
      emitActivity('mission:compromised', `Mission compromised: ${mission.title}`);
    }

  } catch (err) {
    // Clean up stall detection interval on error
    if (stallCheckInterval) {
      clearInterval(stallCheckInterval);
      stallCheckInterval = null;
    }

    if (err instanceof RateLimitError) {
      throw err; // Re-throw for orchestrator to handle
    }

    // Determine if this was an abort (ABANDON)
    const isAbort = abortController.signal.aborted;
    const status = isAbort ? 'abandoned' : 'compromised';
    const errorMsg = err instanceof Error ? err.message : String(err);

    db.update(missions).set({
      status,
      completedAt: Date.now(),
      updatedAt: Date.now(),
      debrief: isAbort
        ? 'Mission abandoned by Commander.'
        : `Mission compromised: ${errorMsg}`,
    }).where(eq(missions.id, mission.id)).run();

    io.to(room).emit('mission:status', {
      missionId: mission.id, status, timestamp: Date.now(),
    });
    io.to(`battlefield:${mission.battlefieldId}`).emit('mission:status', {
      missionId: mission.id, status, timestamp: Date.now(),
    });
    emitActivity(`mission:${status}`, `Mission ${status}: ${mission.title}`);

    if (!isAbort) {
      storeLog('error', errorMsg);
    }

    // Worktree + config cleanup for abandoned missions
    if (isAbort) {
      cleanupMissionHome(mission.id);
      if (worktreePath && worktreeBranch && battlefieldRef) {
        try {
          await removeWorktree(battlefieldRef.repoPath, worktreePath, worktreeBranch);
        } catch {
          // Best effort cleanup
        }
      }
    }

    // Preserve branch info for compromised missions
    if (!isAbort && worktreeBranch) {
      db.update(missions).set({
        debrief: `Mission compromised: ${errorMsg}\nBranch \`${worktreeBranch}\` preserved for inspection.`,
        updatedAt: Date.now(),
      }).where(eq(missions.id, mission.id)).run();
    }
  }
}
