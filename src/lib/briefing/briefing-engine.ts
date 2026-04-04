import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { eq } from 'drizzle-orm';
import type { Server as SocketIOServer } from 'socket.io';
import { getDatabase } from '@/lib/db/index';
import { createAuthenticatedHomeAt } from '@/lib/process/claude-print';
import { getSystemAsset } from '@/lib/orchestrator/system-asset';
import { buildAssetCliArgs } from '@/lib/orchestrator/asset-cli';
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
import { detectCycle } from '@/lib/utils/dependency-graph';

// ---------------------------------------------------------------------------
// Active process tracking (for abort support)
// ---------------------------------------------------------------------------

interface ActiveProcess {
  proc: ChildProcessWithoutNullStreams;
  abort: AbortController;
}

const activeProcesses = new Map<string, ActiveProcess>();

/**
 * Filter multiple flags (and their values) from an args array.
 */
function filterFlags(args: string[], flags: string[]): string[] {
  const flagSet = new Set(flags);
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (flagSet.has(args[i])) { i++; continue; }
    result.push(args[i]);
  }
  return result;
}

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

  // 2. Get or create briefing session (UPSERT to avoid race conditions)
  const now = Date.now();

  db.insert(briefingSessions)
    .values({
      id: generateId(),
      campaignId,
      sessionId: null,
      assetId: null,
      status: 'open',
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();

  const session = db
    .select()
    .from(briefingSessions)
    .where(eq(briefingSessions.campaignId, campaignId))
    .get()!;

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

  // 5. Load GENERAL asset for full config (model, system prompt, skills, MCPs)
  const generalAsset = getSystemAsset('GENERAL');

  // Build asset CLI args, filtering --max-turns (we set our own).
  // --append-system-prompt carries the GENERAL's identity and is kept.
  const assetArgs = buildAssetCliArgs(generalAsset);
  const filteredAssetArgs = filterFlags(assetArgs, ['--max-turns']);

  // 6. Detect GENERATE PLAN — uses a completely fresh process (no --resume)
  // so the GENERAL gets up-to-date format instructions instead of relying on
  // the old session's system prompt which may lack strict JSON requirements.
  const isFirstMessage = !session.sessionId;
  const isGeneratePlan = message.trim().toUpperCase().includes('GENERATE PLAN');

  const cliArgs: string[] = [
    '--print',
    '--verbose',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--dangerously-skip-permissions',
    '--max-turns', '3',
    ...filteredAssetArgs,
  ];

  // Resume the existing session for normal conversation messages only.
  // GENERATE PLAN always starts fresh — the old session's system prompt doesn't
  // include strict JSON format rules, so the GENERAL ignores them.
  if (!isFirstMessage && session.sessionId && !isGeneratePlan) {
    cliArgs.push('--resume', session.sessionId);
  }

  // 7. Build stdin content
  let stdinContent: string;

  if (isGeneratePlan && !isFirstMessage) {
    // Build a self-contained prompt with conversation history and strict format rules.
    const history = db
      .select({ role: briefingMessages.role, content: briefingMessages.content })
      .from(briefingMessages)
      .where(eq(briefingMessages.briefingId, session!.id))
      .all();

    const conversationLines = history.map((m) =>
      m.role === 'commander' ? `Commander: ${m.content}` : `GENERAL: ${m.content.slice(0, 2000)}`,
    );

    stdinContent = `You are GENERAL, a campaign planning specialist for NYHZ OPS DEVROOM.
Campaign: "${campaign.name}" | Battlefield: ${battlefield.codename}

CAMPAIGN OBJECTIVE:
${campaign.objective}

AVAILABLE ASSETS:
${allAssets.filter(a => a.status === 'active' && a.codename !== 'GENERAL').map(a => `- ${a.codename}: ${a.specialty}`).join('\n')}

BRIEFING CONVERSATION SUMMARY:
${conversationLines.join('\n\n')}

---

The Commander has issued GENERATE PLAN. Output ONLY a single raw JSON object. Your ENTIRE response must start with { and end with } — no markdown, no code fences, no backticks, no preamble, no commentary.

Mission briefing values must be PLAIN TEXT — do NOT use markdown code fences (\`\`\`) inside briefing strings. Describe code changes in prose, reference file paths and type names directly.

JSON schema:
{"summary":"...","phases":[{"name":"...","objective":"...","missions":[{"title":"...","briefing":"plain text only","assetCodename":"OPERATIVE","priority":"normal","dependsOn":["same-phase mission title"]}]}]}

Rules: phases execute sequentially, missions within a phase run in parallel unless linked by dependsOn (same-phase only). Each briefing must be self-contained — the asset has NO other context.`;
  } else if (isFirstMessage) {
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
  const persistentHome = createAuthenticatedHomeAt(`/tmp/claude-briefing-${campaignId}`);

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

      // For GENERATE PLAN: extract the plan first, then store a formatted
      // summary in the chat instead of the raw JSON blob.
      let storedContent = responseText;
      if (isGeneratePlan) {
        console.log(`[BRIEFING] GENERATE PLAN triggered for campaign ${campaignId}`);
        console.log(`[BRIEFING] Response length: ${responseText.length}, starts with: ${JSON.stringify(responseText.slice(0, 40))}`);
        try {
          const plan = extractPlanJSON(responseText);
          if (plan) {
            const totalMissions = plan.phases.reduce((s, p) => s + p.missions.length, 0);
            console.log(`[BRIEFING] Plan extracted: ${plan.phases.length} phases, ${totalMissions} missions`);
            insertPlanFromBriefing(campaignId, campaign.battlefieldId, plan);
            console.log(`[BRIEFING] Plan inserted into DB`);

            // Transition campaign to planning
            db.update(campaigns)
              .set({ status: 'planning', updatedAt: Date.now() })
              .where(eq(campaigns.id, campaignId))
              .run();
            console.log(`[BRIEFING] Campaign status → planning`);

            // Format a readable summary for the chat instead of raw JSON
            storedContent = formatPlanSummary(plan);

            io.to(room).emit('briefing:plan-ready', {
              campaignId,
              plan,
            });
            console.log(`[BRIEFING] briefing:plan-ready emitted to room ${room}`);
          } else {
            console.error(`[BRIEFING] extractPlanJSON returned null for campaign ${campaignId}`);
            io.to(room).emit('briefing:error', {
              campaignId,
              error: 'Could not extract a valid JSON plan from GENERAL\'s response. Ask GENERAL to output the plan as a single JSON object with a "summary" key.',
            });
          }
        } catch (err) {
          const planError = err instanceof Error ? err.message : String(err);
          console.error(`[BRIEFING] Plan extraction/insertion failed for campaign ${campaignId}:`, planError);
          io.to(room).emit('briefing:error', {
            campaignId,
            error: `Plan extraction failed: ${planError}`,
          });
        }
      }

      // Store GENERAL's response (formatted summary if plan succeeded, raw otherwise)
      const msgId = generateId();
      db.insert(briefingMessages)
        .values({
          id: msgId,
          briefingId: session!.id,
          role: 'general',
          content: storedContent,
          timestamp: Date.now(),
        })
        .run();

      io.to(room).emit('briefing:complete', { campaignId, messageId: msgId, content: storedContent });

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
// formatPlanSummary — render a PlanJSON as readable markdown for the chat
// ---------------------------------------------------------------------------

function formatPlanSummary(plan: PlanJSON): string {
  const totalMissions = plan.phases.reduce((s, p) => s + p.missions.length, 0);
  const lines: string[] = [];

  lines.push(`**CAMPAIGN PLAN LOCKED** — ${plan.phases.length} phases, ${totalMissions} missions`);
  lines.push('');
  lines.push(`> ${plan.summary}`);
  lines.push('');

  for (let i = 0; i < plan.phases.length; i++) {
    const phase = plan.phases[i];
    lines.push(`**Phase ${i + 1}: ${phase.name}**`);
    if (phase.objective) {
      lines.push(`*${phase.objective}*`);
    }
    for (const m of phase.missions) {
      const deps = m.dependsOn && m.dependsOn.length > 0
        ? ` ← ${m.dependsOn.join(', ')}`
        : '';
      lines.push(`- ${m.title} — \`${m.assetCodename}\` [${m.priority || 'normal'}]${deps}`);
    }
    lines.push('');
  }

  lines.push('*Transitioning to planning phase...*');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// extractPlanJSON — find and parse the JSON plan from GENERAL's response
// ---------------------------------------------------------------------------

function extractPlanJSON(response: string): PlanJSON | null {
  // Best case: the response is pure JSON (GENERAL followed instructions exactly).
  // Try parsing the whole thing first, trimming any whitespace.
  const trimmed = response.trim();
  if (trimmed.startsWith('{')) {
    try {
      const direct = JSON.parse(trimmed) as PlanJSON;
      if (direct.summary && direct.phases) return direct;
    } catch { /* fall through to extraction */ }
  }

  // Find the start of the plan JSON — look for {"summary" which is always the
  // first key. This works whether the JSON is inside a code fence or raw.
  // We can't rely on code fence regex because briefing text inside the JSON
  // often contains its own ``` code blocks, breaking lazy/greedy fence matching.
  // Try all occurrences — GENERAL may output a draft plan before the final one,
  // and earlier ones can be malformed. Iterate from last to first (the final
  // plan in the response is typically the most complete).
  const needles = ['{"summary"', '{\n  "summary"'];
  const candidates: number[] = [];
  for (const needle of needles) {
    let searchFrom = 0;
    while (true) {
      const idx = response.indexOf(needle, searchFrom);
      if (idx === -1) break;
      candidates.push(idx);
      searchFrom = idx + needle.length;
    }
  }

  // Sort descending — try the last occurrence first (most likely the final plan)
  candidates.sort((a, b) => b - a);
  for (const start of candidates) {
    const result = tryParseFrom(response, start);
    if (result) return result;
  }

  return null;
}

function tryParseFrom(text: string, startIndex: number): PlanJSON | null {
  // Find matching closing brace, respecting JSON string escaping.
  // Briefing text inside JSON strings can contain { } characters,
  // so we must track whether we're inside a string to avoid miscounting.
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const raw = text.slice(startIndex, i + 1);
        try {
          return JSON.parse(raw) as PlanJSON;
        } catch {
          // LLMs often produce JSON with literal newlines/tabs inside string
          // values instead of proper \n \t escapes. Sanitize and retry.
          const sanitized = sanitizeJsonStrings(raw);
          try {
            return JSON.parse(sanitized) as PlanJSON;
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

/**
 * Walk a JSON string and escape control characters (newlines, tabs, etc.)
 * that appear unescaped inside string literals. LLMs routinely produce these.
 */
function sanitizeJsonStrings(raw: string): string {
  const out: string[] = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (escape) {
      escape = false;
      out.push(ch);
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      out.push(ch);
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      out.push(ch);
      continue;
    }

    if (inString) {
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        // Replace control characters with their JSON escape sequences
        if (ch === '\n') out.push('\\n');
        else if (ch === '\r') out.push('\\r');
        else if (ch === '\t') out.push('\\t');
        else out.push(`\\u${code.toString(16).padStart(4, '0')}`);
        continue;
      }
    }

    out.push(ch);
  }

  return out.join('');
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

  // Validate no circular dependencies across all missions in the plan
  const allMissions = plan.phases.flatMap((p) =>
    p.missions.map((m) => ({ title: m.title, dependsOn: m.dependsOn ?? [] })),
  );
  const cycle = detectCycle(allMissions);
  if (cycle) throw new Error(`Plan contains circular dependencies: ${cycle}`);

  // Pre-fetch all assets for codename -> id lookup
  const allAssets = db.select().from(assets).all();
  const assetByCodename = new Map(allAssets.map((a) => [a.codename, a]));

  db.transaction(() => {
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
  });
}
