import { spawn } from 'child_process';
import { createInterface } from 'readline';
import fs from 'fs';
import path from 'path';
import { eq } from 'drizzle-orm';
import { Server as SocketIOServer } from 'socket.io';
import { getDatabase } from '@/lib/db/index';
import { missions, missionLogs, battlefields, assets } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import { config } from '@/lib/config';
import { buildPrompt } from './prompt-builder';
import { StreamParser } from './stream-parser';
import { createWorktree, removeWorktree } from './worktree';
import { mergeBranch } from './merger';
import { askCaptain } from '@/lib/captain/captain';
import { storeCaptainLog, getRecentCaptainLogs } from '@/lib/captain/captain-db';
import { escalate } from '@/lib/captain/escalation';
import { reviewDebrief } from '@/lib/captain/debrief-reviewer';
import type { Mission, StreamResult } from '@/types';

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

    const fullPrompt = buildPrompt(mission, battlefield, asset);

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

    // Step 3: Spawn Claude Code
    const args = [
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--dangerously-skip-permissions',
      '--max-turns', '50',
      ...(mission.sessionId ? ['--session-id', mission.sessionId] : []),
      '--prompt', fullPrompt,
    ];

    const proc = spawn(config.claudePath, args, {
      cwd: workingDirectory,
      signal: abortController.signal,
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

    parser.onToolUse((tool, _input) => {
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
      const finalStatus = r.isError ? 'compromised' : 'accomplished';

      db.update(missions).set({
        sessionId: r.sessionId,
        debrief: r.result,
        costInput: r.usage.inputTokens,
        costOutput: r.usage.outputTokens,
        costCacheHit: r.usage.cacheReadTokens,
        durationMs: r.durationMs,
        status: finalStatus,
        completedAt: Date.now(),
        updatedAt: Date.now(),
      }).where(eq(missions.id, mission.id)).run();

      io.to(room).emit('mission:status', {
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

      // Update asset missions completed count
      if (mission.assetId && finalStatus === 'accomplished') {
        const currentAsset = db.select().from(assets)
          .where(eq(assets.id, mission.assetId)).get();
        if (currentAsset) {
          db.update(assets).set({
            missionsCompleted: (currentAsset.missionsCompleted || 0) + 1,
          }).where(eq(assets.id, mission.assetId)).run();
        }
      }

      // Captain auto-review of debrief (fire-and-forget)
      if (finalStatus === 'accomplished') {
        reviewDebrief({
          missionBriefing: mission.briefing,
          missionDebrief: r.result,
          claudeMd: claudeMdContent,
          missionId: mission.id,
          battlefieldId: mission.battlefieldId,
        }).then(async (review) => {
          // Log the review
          storeCaptainLog({
            missionId: mission.id,
            battlefieldId: mission.battlefieldId,
            campaignId: mission.campaignId,
            question: `[DEBRIEF_REVIEW] Mission: ${mission.title}`,
            answer: review.satisfactory ? 'Satisfactory' : `Concerns: ${review.concerns.join(', ')}`,
            reasoning: review.reasoning,
            confidence: review.satisfactory ? 'high' : 'medium',
            escalated: review.recommendation === 'escalate' ? 1 : 0,
          });

          if (review.recommendation === 'retry') {
            // Auto-redeploy with concerns noted in briefing
            const { redeployMission } = await import('@/actions/mission');
            await redeployMission(mission.id);
          } else if (review.recommendation === 'escalate') {
            await escalate({
              level: 'warning',
              title: `Debrief Review: ${mission.title}`,
              detail: `Concerns: ${review.concerns.join('. ')}. Reasoning: ${review.reasoning}`,
              entityType: 'mission',
              entityId: mission.id,
              battlefieldId: mission.battlefieldId,
            });
          } else if (review.concerns.length > 0) {
            // Satisfactory but with concerns — info notification
            await escalate({
              level: 'info',
              title: `Debrief Note: ${mission.title}`,
              detail: review.concerns.join('. '),
              entityType: 'mission',
              entityId: mission.id,
              battlefieldId: mission.battlefieldId,
            });
          }
        }).catch(err => {
          console.error('[Captain] Debrief review failed:', err);
        });
      }

      // Merge worktree branch back to default branch
      if (worktreeBranch && worktreePath && finalStatus === 'accomplished') {
        storeLog('status', `Merging ${worktreeBranch} into ${battlefield.defaultBranch || 'main'}...`);
        io.to(room).emit('mission:log', {
          missionId: mission.id,
          timestamp: Date.now(),
          type: 'status',
          content: `Merging ${worktreeBranch} into ${battlefield.defaultBranch || 'main'}...\n`,
        });

        const mergeResult = await mergeBranch(
          battlefield.repoPath,
          worktreeBranch,
          battlefield.defaultBranch || 'main',
          { ...mission, debrief: r.result } as Mission,
          battlefield.claudeMdPath,
        );

        if (mergeResult.success) {
          // Clean up worktree immediately
          await removeWorktree(battlefield.repoPath, worktreePath, worktreeBranch);
          storeLog('status', mergeResult.conflictResolved
            ? 'Merge complete (conflicts auto-resolved). Worktree cleaned up.'
            : 'Merge complete. Worktree cleaned up.');
        } else {
          // Merge failed — downgrade to compromised
          db.update(missions).set({
            status: 'compromised',
            debrief: r.result + `\n\n---\n\nMERGE FAILED: ${mergeResult.error}\nBranch \`${worktreeBranch}\` preserved for inspection.`,
            updatedAt: Date.now(),
          }).where(eq(missions.id, mission.id)).run();

          io.to(room).emit('mission:status', {
            missionId: mission.id, status: 'compromised', timestamp: Date.now(),
          });
          storeLog('error', `Merge failed: ${mergeResult.error}. Branch preserved.`);
          emitActivity('mission:compromised', `Mission compromised (merge failed): ${mission.title}`);
        }
      }
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
    emitActivity(`mission:${status}`, `Mission ${status}: ${mission.title}`);

    if (!isAbort) {
      storeLog('error', errorMsg);
    }

    // Worktree cleanup for abandoned missions
    if (isAbort && worktreePath && worktreeBranch && battlefieldRef) {
      try {
        await removeWorktree(battlefieldRef.repoPath, worktreePath, worktreeBranch);
      } catch {
        // Best effort cleanup
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
