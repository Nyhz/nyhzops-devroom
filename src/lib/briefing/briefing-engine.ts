import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import os from 'os';
import { eq } from 'drizzle-orm';
import type { Server as SocketIOServer } from 'socket.io';
import { getDatabase } from '@/lib/db/index';
import {
  briefingSessions,
  briefingMessages,
  campaigns,
  battlefields,
  assets,
  phases,
  missions,
} from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import { config } from '@/lib/config';
import { buildBriefingPrompt } from './briefing-prompt';
import type { PlanJSON } from '@/types';

// ---------------------------------------------------------------------------
// Active process tracking (for abort support)
// ---------------------------------------------------------------------------

interface ActiveProcess {
  proc: ChildProcessWithoutNullStreams;
  abort: AbortController;
}

const activeProcesses = new Map<string, ActiveProcess>();

// ---------------------------------------------------------------------------
// sendBriefingMessage — core entry point
// ---------------------------------------------------------------------------

export async function sendBriefingMessage(
  io: SocketIOServer,
  campaignId: string,
  message: string,
): Promise<void> {
  const db = getDatabase();

  // 1. Load campaign + battlefield
  const campaign = db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .get();

  if (!campaign) {
    throw new Error(`sendBriefingMessage: campaign ${campaignId} not found`);
  }

  const battlefield = db
    .select()
    .from(battlefields)
    .where(eq(battlefields.id, campaign.battlefieldId))
    .get();

  if (!battlefield) {
    throw new Error(
      `sendBriefingMessage: battlefield ${campaign.battlefieldId} not found`,
    );
  }

  // 2. Get or create briefing session
  let session = db
    .select()
    .from(briefingSessions)
    .where(eq(briefingSessions.campaignId, campaignId))
    .get();

  const now = Date.now();

  if (!session) {
    const sessionId = generateId();
    db.insert(briefingSessions)
      .values({
        id: sessionId,
        campaignId,
        sessionId: null,
        assetId: null,
        status: 'open',
        createdAt: now,
        updatedAt: now,
      })
      .run();

    session = db
      .select()
      .from(briefingSessions)
      .where(eq(briefingSessions.id, sessionId))
      .get()!;
  }

  // 3. Store the Commander's message
  db.insert(briefingMessages)
    .values({
      id: generateId(),
      briefingId: session.id,
      role: 'commander',
      content: message,
      timestamp: now,
    })
    .run();

  // 4. Load all active assets
  const allAssets = db.select().from(assets).all();

  // 5. Find GENERAL asset to get model
  const generalAsset = allAssets.find(
    (a) => a.codename === 'GENERAL' && a.status === 'active',
  );
  const generalModel = generalAsset?.model || 'claude-sonnet-4-6';

  // 6. Build CLI args
  const isFirstMessage = !session.sessionId;
  const cliArgs: string[] = [
    '--print',
    '--verbose',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--dangerously-skip-permissions',
    '--max-turns', '3',
    '--model', generalModel,
  ];

  if (!isFirstMessage && session.sessionId) {
    cliArgs.push('--resume', session.sessionId);
  }

  // 7. Build stdin content
  let stdinContent: string;

  if (isFirstMessage) {
    const systemPrompt = buildBriefingPrompt({
      campaignName: campaign.name,
      campaignObjective: campaign.objective,
      battlefieldCodename: battlefield.codename,
      claudeMdPath: battlefield.claudeMdPath,
      specMdPath: battlefield.specMdPath,
      allAssets,
    });
    stdinContent = systemPrompt + '\n\n---\n\nCommander says: ' + message;
  } else {
    stdinContent = message;
  }

  // 8. Spawn Claude process with isolated HOME
  // Use a persistent HOME per campaign so --resume can find previous session data
  // Auth is handled natively via macOS Keychain — no credential file copying needed
  const persistentHome = `/tmp/claude-briefing-${campaignId}`;
  const persistentClaudeDir = `${persistentHome}/.claude`;
  fs.mkdirSync(persistentClaudeDir, { recursive: true });
  const realHome = process.env.HOME || os.homedir();
  try { fs.copyFileSync(`${realHome}/.claude.json`, `${persistentHome}/.claude.json`); } catch { /* fine */ }
  try { fs.copyFileSync(`${realHome}/.claude/settings.json`, `${persistentClaudeDir}/settings.json`); } catch { /* fine */ }

  const abortController = new AbortController();
  const proc = spawn(config.claudePath, cliArgs, {
    cwd: battlefield.repoPath,
    signal: abortController.signal,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, HOME: persistentHome },
  });

  activeProcesses.set(campaignId, { proc, abort: abortController });

  const room = `briefing:${campaignId}`;
  let fullResponse = '';
  let extractedSessionId: string | null = null;
  let lineBuffer = '';

  // Parse stream-json output line by line
  proc.stdout.on('data', (chunk: Buffer) => {
    lineBuffer += chunk.toString();
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);

        // Extract session ID from any event that has it
        if (event.session_id && !extractedSessionId) {
          extractedSessionId = event.session_id;
        }

        // Stream deltas from stream_event wrapper (real-time token streaming)
        if (event.type === 'stream_event' && event.event) {
          const inner = event.event;
          if (inner.type === 'content_block_delta' && inner.delta?.type === 'text_delta' && inner.delta.text) {
            fullResponse += inner.delta.text;
            io.to(room).emit('briefing:chunk', { campaignId, content: inner.delta.text });
          }
        }

        // Result event — capture session ID and final text fallback
        if (event.type === 'result') {
          if (event.session_id) extractedSessionId = event.session_id;
          if (!fullResponse && event.result && typeof event.result === 'string') {
            fullResponse = event.result;
            io.to(room).emit('briefing:chunk', { campaignId, content: event.result });
          }
        }
      } catch {
        // Not valid JSON — ignore
      }
    }
  });

  // Capture stderr for debugging
  let stderrOutput = '';
  proc.stderr.on('data', (chunk: Buffer) => {
    stderrOutput += chunk.toString();
  });

  // Write message to stdin and close
  proc.stdin.write(stdinContent);
  proc.stdin.end();

  // Wait for process to complete
  return new Promise<void>((resolve, reject) => {
    proc.on('close', (code) => {
      activeProcesses.delete(campaignId);

      // Process any remaining buffered line
      if (lineBuffer.trim()) {
        try {
          const event = JSON.parse(lineBuffer);
          if (event.session_id && !extractedSessionId) {
            extractedSessionId = event.session_id;
          }
          if (event.type === 'result') {
            if (event.session_id) extractedSessionId = event.session_id;
            if (!fullResponse && event.result && typeof event.result === 'string') {
              fullResponse = event.result;
            }
          }
        } catch { /* ignore */ }
      }

      // Update session with Claude session ID
      if (extractedSessionId) {
        db.update(briefingSessions)
          .set({
            sessionId: extractedSessionId,
            updatedAt: Date.now(),
          })
          .where(eq(briefingSessions.id, session!.id))
          .run();
      }

      if (code !== 0 && code !== null) {
        const errorMsg = `GENERAL process exited with code ${code}: ${stderrOutput.slice(0, 500)}`;
        io.to(room).emit('briefing:error', { campaignId, error: errorMsg });
        reject(new Error(errorMsg));
        return;
      }

      const responseText = fullResponse.trim();

      // Store GENERAL's response
      const msgId = generateId();
      db.insert(briefingMessages)
        .values({
          id: msgId,
          briefingId: session!.id,
          role: 'general',
          content: responseText,
          timestamp: Date.now(),
        })
        .run();

      io.to(room).emit('briefing:complete', { campaignId, messageId: msgId, content: responseText });

      // Check if Commander requested plan generation
      const normalizedMessage = message.trim().toUpperCase();
      if (normalizedMessage.includes('GENERATE PLAN')) {
        try {
          const plan = extractPlanJSON(responseText);
          if (plan) {
            insertPlanFromBriefing(campaignId, campaign.battlefieldId, plan);

            // Transition campaign to planning
            db.update(campaigns)
              .set({ status: 'planning', updatedAt: Date.now() })
              .where(eq(campaigns.id, campaignId))
              .run();

            io.to(room).emit('briefing:plan-ready', {
              campaignId,
              plan,
            });
          }
        } catch (err) {
          const planError = err instanceof Error ? err.message : String(err);
          io.to(room).emit('briefing:error', {
            campaignId,
            error: `Plan extraction failed: ${planError}`,
          });
        }
      }

      resolve();
    });

    proc.on('error', (err) => {
      activeProcesses.delete(campaignId);
      io.to(room).emit('briefing:error', {
        campaignId,
        error: err.message,
      });
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// abortBriefing — cancel an in-progress GENERAL response
// ---------------------------------------------------------------------------

export function abortBriefing(campaignId: string): boolean {
  const active = activeProcesses.get(campaignId);
  if (!active) return false;

  active.abort.abort();
  activeProcesses.delete(campaignId);
  return true;
}

// ---------------------------------------------------------------------------
// deleteBriefingData — cleanup on campaign launch
// ---------------------------------------------------------------------------

export function deleteBriefingData(campaignId: string): void {
  const db = getDatabase();

  // Find all briefing sessions for this campaign
  const sessions = db
    .select({ id: briefingSessions.id })
    .from(briefingSessions)
    .where(eq(briefingSessions.campaignId, campaignId))
    .all();

  const sessionIds = sessions.map((s) => s.id);

  if (sessionIds.length > 0) {
    // Delete messages for each session
    for (const sid of sessionIds) {
      db.delete(briefingMessages)
        .where(eq(briefingMessages.briefingId, sid))
        .run();
    }

    // Delete sessions
    db.delete(briefingSessions)
      .where(eq(briefingSessions.campaignId, campaignId))
      .run();
  }
}

// ---------------------------------------------------------------------------
// extractPlanJSON — find and parse the JSON plan from GENERAL's response
// ---------------------------------------------------------------------------

function extractPlanJSON(response: string): PlanJSON | null {
  // Try to find JSON block in markdown code fence
  const fenceMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1]) as PlanJSON;
    } catch { /* fall through to raw parse */ }
  }

  // Try to find a raw JSON object with "phases" key
  const jsonStart = response.indexOf('{"summary"');
  if (jsonStart === -1) {
    const altStart = response.indexOf('{\n  "summary"');
    if (altStart !== -1) {
      return tryParseFrom(response, altStart);
    }
    return null;
  }

  return tryParseFrom(response, jsonStart);
}

function tryParseFrom(text: string, startIndex: number): PlanJSON | null {
  // Find matching closing brace
  let depth = 0;
  for (let i = startIndex; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(startIndex, i + 1)) as PlanJSON;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// insertPlanFromBriefing — replicate insertPlanFromJSON from campaign actions
// ---------------------------------------------------------------------------

function insertPlanFromBriefing(
  campaignId: string,
  battlefieldId: string,
  plan: PlanJSON,
): void {
  const db = getDatabase();
  const now = Date.now();

  // Pre-fetch all assets for codename -> id lookup
  const allAssets = db.select().from(assets).all();
  const assetByCodename = new Map(allAssets.map((a) => [a.codename, a]));

  for (let i = 0; i < plan.phases.length; i++) {
    const planPhase = plan.phases[i];
    const phaseId = generateId();

    db.insert(phases)
      .values({
        id: phaseId,
        campaignId,
        phaseNumber: i + 1,
        name: planPhase.name,
        objective: planPhase.objective || null,
        status: 'standby',
        createdAt: now,
      })
      .run();

    for (const planMission of planPhase.missions) {
      const asset = assetByCodename.get(planMission.assetCodename);
      const missionId = generateId();

      db.insert(missions)
        .values({
          id: missionId,
          battlefieldId,
          campaignId,
          phaseId,
          type: 'standard',
          title: planMission.title,
          briefing: planMission.briefing,
          status: 'standby',
          priority: planMission.priority || 'normal',
          assetId: asset?.id ?? null,
          dependsOn:
            planMission.dependsOn && planMission.dependsOn.length > 0
              ? JSON.stringify(planMission.dependsOn)
              : null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
  }
}
