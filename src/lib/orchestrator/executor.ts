import { spawn } from 'child_process';
import { createInterface } from 'readline';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { eq } from 'drizzle-orm';
import { Server as SocketIOServer } from 'socket.io';
import { getDatabase } from '@/lib/db/index';
import { missions, missionLogs, battlefields, assets, campaigns } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import { config } from '@/lib/config';
import { buildPrompt } from './prompt-builder';
import { buildAssetCliArgs } from './asset-cli';
import { StreamParser } from './stream-parser';
import type { SkillOverrides } from '@/types';
import { extractKeychainCredentials } from '@/lib/process/claude-print';
import { createWorktree, removeWorktree } from './worktree';
import { askOverseer } from '@/lib/overseer/overseer';
import { storeOverseerLog, getRecentOverseerLogs } from '@/lib/overseer/overseer-db';
import { escalate } from '@/lib/overseer/escalation';
import { runOverseerReview } from '@/lib/overseer/review-handler';
import { extractAndSaveSuggestions } from '@/actions/follow-up';
import { getOverseerLogs } from '@/actions/overseer';
import type { Mission, StreamResult } from '@/types';
import { checkCliAuth } from './auth-check';
import type { Orchestrator } from './orchestrator';
import { emitStatusChange } from '@/lib/socket/emit';

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
    emitStatusChange('mission', mission.id, status, extra);
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
  let hardTimeout: NodeJS.Timeout | null = null;
  let timedOut = false;
  let stderrOutput = '';
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
          detail: 'Queue paused. All missions held.\nCheck `claude auth status` and re-login if needed.',
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

    // Check for overseer retry feedback
    const retryAttempts = mission.reviewAttempts ?? 0;
    if (retryAttempts > 0) {
      const overseerLogs = await getOverseerLogs({ missionId: mission.id });
      const retryFeedback = overseerLogs
        .filter(log => log.question.startsWith('[RETRY_FEEDBACK]'))
        .pop();

      if (retryFeedback) {
        fullPrompt += `\n\n---\n\nOVERSEER REVIEW FEEDBACK (Retry ${retryAttempts})\n========================================\nThe Overseer reviewed your previous work and found these concerns:\n${retryFeedback.answer}\n\nOverseer's reasoning: ${retryFeedback.reasoning}\n\nPlease address these concerns. Your previous session context is preserved.\nYou have access to all changes you made previously.\n\nOriginal briefing:\n${mission.briefing}`;
      }
    }

    // Read CLAUDE.md content for Overseer context
    let claudeMdContent: string | null = null;
    if (battlefield.claudeMdPath) {
      try {
        claudeMdContent = fs.readFileSync(battlefield.claudeMdPath, 'utf-8');
      } catch { /* skip */ }
    }

    // Build campaign context string for Overseer
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
    // Parse skill overrides from mission
    const skillOverrides: SkillOverrides | null = mission.skillOverrides
      ? (JSON.parse(mission.skillOverrides) as SkillOverrides)
      : null;

    const args = [
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--dangerously-skip-permissions',
    ];

    // Asset args (model, max-turns, effort, system prompt, skills, MCPs)
    if (asset) {
      args.push(...buildAssetCliArgs(asset, skillOverrides));
    } else {
      args.push('--max-turns', '100');
    }

    args.push(fullPrompt);

    // Isolate Claude config per mission to prevent concurrent write corruption
    // and session ID collisions. Each mission gets its own HOME.
    // Auth is handled natively via macOS Keychain — no credential file copying needed.
    const missionHome = `/tmp/claude-config/${mission.id}`;
    const missionClaudeDir = path.join(missionHome, '.claude');
    fs.mkdirSync(missionClaudeDir, { recursive: true });
    const realHome = process.env.HOME || os.homedir();
    try {
      fs.copyFileSync(path.join(realHome, '.claude.json'), path.join(missionHome, '.claude.json'));
    } catch { /* no .claude.json — fine */ }
    try {
      fs.copyFileSync(path.join(realHome, '.claude', 'settings.json'), path.join(missionClaudeDir, 'settings.json'));
    } catch { /* skip missing */ }
    // Extract credentials from macOS Keychain into isolated HOME
    const cred = extractKeychainCredentials();
    if (cred) {
      fs.writeFileSync(path.join(missionClaudeDir, '.credentials.json'), cred, { mode: 0o600 });
    }

    const proc = spawn(config.claudePath, args, {
      cwd: workingDirectory,
      signal: abortController.signal,
      env: { ...process.env, HOME: missionHome },
    });

    // Hard timeout — 30 minutes. Kills the process if it hangs indefinitely.
    const HARD_TIMEOUT_MS = 30 * 60 * 1000;
    hardTimeout = setTimeout(() => {
      timedOut = true;
      console.warn(`[Executor] Mission ${mission.id} hit 30-minute hard timeout. Killing process.`);
      abortController.abort();
    }, HARD_TIMEOUT_MS);

    // Capture stderr — set up BEFORE readline loop so we don't miss output
    proc.stderr?.on('data', (data: Buffer) => {
      stderrOutput += data.toString();
    });

    // Step 4: IN COMBAT
    updateStatus('in_combat', { startedAt: Date.now() });
    emitActivity('mission:in_combat', `Mission in combat: ${mission.title}`);

    // Step 5: Parse stream
    const parser = new StreamParser();

    // Overseer stall detection state
    let lastAssistantContent = '';
    let lastActivityTime = Date.now();
    let waitingForInput = false;
    let lastMessageHadToolUse = false;
    let recentOutputBuffer = '';

    // Track best debrief candidate from assistant turns
    let bestDebrief: string | null = null;

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

      // Track debrief candidates — assistant messages containing debrief markers
      const debriefPattern = /\*?\*?DEBRIEF\*?\*?|## What Was Done|## Summary|## Changes Made|## Files (Modified|Changed)/i;
      if (debriefPattern.test(content) && content.length > (bestDebrief?.length ?? 0)) {
        bestDebrief = content;
      }
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

    // Overseer stall detection interval — check every 5 seconds for 15-second silence
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
          // Get Overseer's decision
          const decision = await askOverseer({
            question: lastAssistantContent,
            missionBriefing: mission.briefing,
            claudeMd: claudeMdContent,
            recentOutput: recentOutputBuffer.slice(-2000),
            overseerHistory: getRecentOverseerLogs(mission.id, 5),
            campaignContext: campaignContextString || undefined,
          });

          // Store in overseer log
          storeOverseerLog({
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
          const overseerMsg = `[OVERSEER] ${decision.answer}\n(confidence: ${decision.confidence})`;
          io.to(room).emit('mission:log', {
            missionId: mission.id,
            timestamp: Date.now(),
            type: 'status',
            content: overseerMsg + '\n',
          });
          storeLog('status', overseerMsg);

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
              type: 'overseer:escalation',
              battlefieldCodename: bf?.codename || 'UNKNOWN',
              missionTitle: mission.title,
              timestamp: Date.now(),
              detail: `Overseer escalation: ${decision.reasoning}`,
            });

            // Send Telegram escalation notification
            escalate({
              level: decision.confidence === 'low' ? 'warning' : 'info',
              title: `Overseer Escalation: ${mission.title}`,
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

    // Clean up stall detection interval and hard timeout on normal exit
    if (stallCheckInterval) {
      clearInterval(stallCheckInterval);
      stallCheckInterval = null;
    }
    if (hardTimeout) clearTimeout(hardTimeout);

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

      // Prefer a debrief-pattern match from comms over the final result message,
      // which may be a short ack if the agent kept responding after the debrief.
      const debrief = bestDebrief ?? r.result;

      const compromiseReasonOnError = r.isError ? 'execution-failed' : undefined;
      db.update(missions).set({
        sessionId: r.sessionId,
        debrief,
        costInput: r.usage.inputTokens,
        costOutput: r.usage.outputTokens,
        costCacheHit: r.usage.cacheReadTokens,
        durationMs: r.durationMs,
        status: finalStatus,
        completedAt: r.isError ? Date.now() : null,
        updatedAt: Date.now(),
        ...(compromiseReasonOnError ? { compromiseReason: compromiseReasonOnError } : {}),
      }).where(eq(missions.id, mission.id)).run();

      emitStatusChange('mission', mission.id, finalStatus, compromiseReasonOnError ? { compromiseReason: compromiseReasonOnError } : {});
      io.to(room).emit('mission:debrief', {
        missionId: mission.id, debrief,
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

      // Update asset missions completed count (reviewing = work done, pending overseer approval)
      if (mission.assetId && finalStatus === 'reviewing') {
        const currentAsset = db.select().from(assets)
          .where(eq(assets.id, mission.assetId)).get();
        if (currentAsset) {
          db.update(assets).set({
            missionsCompleted: (currentAsset.missionsCompleted || 0) + 1,
          }).where(eq(assets.id, mission.assetId)).run();
        }
      }

      // Overseer review — async, non-blocking
      // Merge happens AFTER Overseer approves (in promoteMission), not here.
      runOverseerReview(mission.id).catch(err => {
        console.error('[Overseer] Review handler failed:', err);
      });
    } else {
      // No result message — process exited without proper completion
      const compromisedDebrief = `Process exited with code ${exitCode}. ${stderrOutput ? 'Stderr: ' + stderrOutput.slice(0, 500) : 'No output captured.'}`;
      const finalDebrief = worktreeBranch
        ? compromisedDebrief + `\nBranch \`${worktreeBranch}\` preserved for inspection.`
        : compromisedDebrief;
      updateStatus('compromised', {
        completedAt: Date.now(),
        debrief: finalDebrief,
        compromiseReason: 'execution-failed',
      });
      emitActivity('mission:compromised', `Mission compromised: ${mission.title}`);

      // Extract follow-up suggestions from compromised debrief
      extractAndSaveSuggestions({
        battlefieldId: mission.battlefieldId,
        missionId: mission.id,
        campaignId: mission.campaignId ?? undefined,
        debrief: finalDebrief,
      }).then(suggestions => {
        if (suggestions.length > 0) {
          io.to(room).emit('mission:suggestions', { missionId: mission.id, suggestions });
        }
      }).catch(err => {
        console.error(`[Executor] Suggestion extraction failed for mission ${mission.id}:`, err);
      });
    }

  } catch (err) {
    // Clean up stall detection interval and hard timeout on error
    if (stallCheckInterval) {
      clearInterval(stallCheckInterval);
      stallCheckInterval = null;
    }
    if (hardTimeout) clearTimeout(hardTimeout);

    if (err instanceof RateLimitError) {
      throw err; // Re-throw for orchestrator to handle
    }

    // Determine failure mode: timeout, user abort, or process error
    const isAbort = abortController.signal.aborted;
    const status = isAbort && !timedOut ? 'abandoned' : 'compromised';
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Resolve compromiseReason: timeout takes precedence, then execution-failed
    const compromiseReason = timedOut
      ? 'timeout'
      : (!isAbort ? 'execution-failed' : undefined);

    db.update(missions).set({
      status,
      completedAt: Date.now(),
      updatedAt: Date.now(),
      debrief: isAbort && !timedOut
        ? 'Mission abandoned by Commander.'
        : timedOut
          ? `Mission timed out after 30 minutes.${stderrOutput ? ' Stderr: ' + stderrOutput.slice(0, 500) : ''}`
          : `Mission compromised: ${errorMsg}`,
      ...(compromiseReason ? { compromiseReason } : {}),
    }).where(eq(missions.id, mission.id)).run();

    emitStatusChange('mission', mission.id, status, compromiseReason ? { compromiseReason } : {});
    emitActivity(`mission:${status}`, `Mission ${status}: ${mission.title}`);

    const isUserAbort = isAbort && !timedOut;

    if (!isUserAbort) {
      storeLog('error', timedOut ? `Mission timed out after 30 minutes.` : errorMsg);
    }

    // Worktree + config cleanup for user-abandoned missions
    if (isUserAbort) {
      cleanupMissionHome(mission.id);
      if (worktreePath && worktreeBranch && battlefieldRef) {
        try {
          await removeWorktree(battlefieldRef.repoPath, worktreePath, worktreeBranch);
        } catch {
          // Best effort cleanup
        }
      }
    }

    // Preserve branch info for compromised/timed-out missions
    if (!isUserAbort && worktreeBranch) {
      const branchDebrief = timedOut
        ? `Mission timed out after 30 minutes.\nBranch \`${worktreeBranch}\` preserved for inspection.`
        : `Mission compromised: ${errorMsg}\nBranch \`${worktreeBranch}\` preserved for inspection.`;
      db.update(missions).set({
        debrief: branchDebrief,
        updatedAt: Date.now(),
      }).where(eq(missions.id, mission.id)).run();
    }

    // Extract follow-up suggestions from compromised/timed-out debrief
    if (!isUserAbort) {
      const catchDebrief = timedOut
        ? (worktreeBranch
          ? `Mission timed out after 30 minutes.\nBranch \`${worktreeBranch}\` preserved for inspection.`
          : `Mission timed out after 30 minutes.`)
        : (worktreeBranch
          ? `Mission compromised: ${errorMsg}\nBranch \`${worktreeBranch}\` preserved for inspection.`
          : `Mission compromised: ${errorMsg}`);
      extractAndSaveSuggestions({
        battlefieldId: mission.battlefieldId,
        missionId: mission.id,
        campaignId: mission.campaignId ?? undefined,
        debrief: catchDebrief,
      }).then(suggestions => {
        if (suggestions.length > 0) {
          io.to(room).emit('mission:suggestions', { missionId: mission.id, suggestions });
        }
      }).catch(extractErr => {
        console.error(`[Executor] Suggestion extraction failed for mission ${mission.id}:`, extractErr);
      });
    }
  }
}
