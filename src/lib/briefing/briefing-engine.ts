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
} from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import { config } from '@/lib/config';
import { buildBriefingSystemPrompt } from './briefing-prompt';
import { insertPlanFromJSON } from '@/actions/campaign-helpers';
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

  // 5. Load STRATEGIST asset for full config (model, system prompt, skills, MCPs)
  const strategistAsset = getSystemAsset('STRATEGIST');

  // Build asset CLI args, filtering --max-turns (we set our own).
  // --append-system-prompt carries the STRATEGIST's identity and is kept.
  const assetArgs = buildAssetCliArgs(strategistAsset);
  const filteredAssetArgs = filterFlags(assetArgs, ['--max-turns']);

  // 6. Detect GENERATE PLAN — uses a completely fresh process (no --resume)
  // so the STRATEGIST gets up-to-date format instructions instead of relying on
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
  // include strict JSON format rules, so the STRATEGIST ignores them.
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
      m.role === 'commander' ? `Commander: ${m.content}` : `STRATEGIST: ${m.content.slice(0, 2000)}`,
    );

    stdinContent = `You are STRATEGIST, a campaign planning specialist for NYHZ OPS DEVROOM.
Campaign: "${campaign.name}" | Battlefield: ${battlefield.codename}

CAMPAIGN OBJECTIVE:
${campaign.objective}

AVAILABLE ASSETS:
${allAssets.filter(a => a.status === 'active' && a.codename !== 'STRATEGIST').map(a => `- ${a.codename}: ${a.specialty}`).join('\n')}

BRIEFING CONVERSATION SUMMARY:
${conversationLines.join('\n\n')}

---

The Commander has issued GENERATE PLAN. Output ONLY a single raw JSON object. Your ENTIRE response must start with { and end with } — no markdown, no code fences, no backticks, no preamble, no commentary.

Mission briefing values must be PLAIN TEXT — do NOT use markdown code fences (\`\`\`) inside briefing strings. Describe code changes in prose, reference file paths and type names directly.

JSON schema:
{"summary":"...","phases":[{"name":"...","objective":"...","missions":[{"title":"...","briefing":"plain text only","assetCodename":"OPERATIVE","priority":"routine","type":"direct_action","dependsOn":["same-phase mission title"]}]}]}

Rules: phases execute sequentially, missions within a phase run in parallel unless linked by dependsOn (same-phase only). Each briefing must be self-contained — the asset has NO other context.

Mission "type" is optional and defaults to "direct_action". Use "verification" for strictly read-only missions that run tests/type-checks/audits and report results without modifying code. Verification missions must produce zero commits; direct_action missions must produce at least one. Use "verification" whenever the briefing verbs are run/check/verify/confirm/audit/report; use "direct_action" whenever the briefing asks to write/edit/refactor/fix/implement.`;
  } else if (isFirstMessage) {
    const systemPrompt = buildBriefingSystemPrompt({
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
        const errorMsg = `STRATEGIST process exited with code ${code}: ${stderrOutput.slice(0, 500)}`;
        io.to(room).emit('briefing:error', { campaignId, error: errorMsg });
        reject(new Error(errorMsg));
        return;
      }

      const responseText = fullResponse.trim();

      // For GENERATE PLAN: extract the plan first, then store a formatted
      // summary in the chat instead of the raw JSON blob.
      let storedContent = responseText;
      if (isGeneratePlan) {
        try {
          const plan = extractPlanJSON(responseText);
          if (plan) {
            const totalMissions = plan.phases.reduce((s, p) => s + p.missions.length, 0);
            console.log(`[BRIEFING] Plan generated for campaign ${campaignId}: ${plan.phases.length} phases, ${totalMissions} missions`);
            // Validate no circular dependencies
            const allMissions = plan.phases.flatMap((p) =>
              p.missions.map((m) => ({ title: m.title, dependsOn: m.dependsOn ?? [] })),
            );
            const cycle = detectCycle(allMissions);
            if (cycle) throw new Error(`Plan contains circular dependencies: ${cycle}`);

            insertPlanFromJSON(campaignId, campaign.battlefieldId, plan);

            // Transition campaign to planning
            db.update(campaigns)
              .set({ status: 'planning', updatedAt: Date.now() })
              .where(eq(campaigns.id, campaignId))
              .run();

            // Format a readable summary for the chat instead of raw JSON
            storedContent = formatPlanSummary(plan);

            io.to(room).emit('briefing:plan-ready', {
              campaignId,
              plan,
            });
          } else {
            console.error(`[BRIEFING] extractPlanJSON returned null for campaign ${campaignId}`);
            io.to(room).emit('briefing:error', {
              campaignId,
              error: 'Could not extract a valid JSON plan from STRATEGIST\'s response. Ask the STRATEGIST to output the plan as a single JSON object with a "summary" key.',
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

      // Store STRATEGIST's response (formatted summary if plan succeeded, raw otherwise)
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
// abortBriefing — cancel an in-progress STRATEGIST response
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
      lines.push(`- ${m.title} — \`${m.assetCodename}\` [${m.priority || 'routine'}]${deps}`);
    }
    lines.push('');
  }

  lines.push('*Transitioning to planning phase...*');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// extractPlanJSON — find and parse the JSON plan from STRATEGIST's response
// ---------------------------------------------------------------------------

function extractPlanJSON(response: string): PlanJSON | null {
  // Best case: the response is pure JSON
  const trimmed = response.trim();
  if (trimmed.startsWith('{')) {
    try {
      const direct = JSON.parse(trimmed) as PlanJSON;
      if (direct.summary && direct.phases) return direct;
    } catch { /* fall through to extraction */ }
  }

  // Find all candidate start positions for the plan JSON object.
  // We search from last to first — the final plan in the response is
  // typically the most complete when STRATEGIST outputs drafts before the final.
  const candidates: number[] = [];
  let searchFrom = 0;
  while (true) {
    const idx = response.indexOf('"summary"', searchFrom);
    if (idx === -1) break;
    // Walk backwards to find the opening brace
    const braceIdx = response.lastIndexOf('{', idx);
    if (braceIdx !== -1) candidates.push(braceIdx);
    searchFrom = idx + 1;
  }

  // Try last occurrence first
  for (let i = candidates.length - 1; i >= 0; i--) {
    const result = tryParseFrom(response, candidates[i]);
    if (result) return result;
  }

  return null;
}

function tryParseFrom(text: string, startIndex: number): PlanJSON | null {
  // Track brace depth and string state to find the matching closing brace.
  // Required because briefing text inside JSON strings can contain { } characters.
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const raw = text.slice(startIndex, i + 1);
        try {
          return JSON.parse(raw) as PlanJSON;
        } catch {
          // LLMs sometimes produce literal control characters inside JSON strings.
          try {
            return JSON.parse(sanitizeControlChars(raw)) as PlanJSON;
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

/** Replace unescaped control characters inside JSON string values. */
function sanitizeControlChars(raw: string): string {
  const out: string[] = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (esc) { esc = false; out.push(ch); continue; }
    if (ch === '\\' && inStr) { esc = true; out.push(ch); continue; }
    if (ch === '"') { inStr = !inStr; out.push(ch); continue; }
    if (inStr && ch.charCodeAt(0) < 0x20) {
      if (ch === '\n') out.push('\\n');
      else if (ch === '\r') out.push('\\r');
      else if (ch === '\t') out.push('\\t');
      else out.push(`\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
      continue;
    }
    out.push(ch);
  }
  return out.join('');
}
