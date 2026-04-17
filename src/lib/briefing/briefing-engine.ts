import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';
import { eq } from 'drizzle-orm';
import type { Server as SocketIOServer } from 'socket.io';
import { getDatabase } from '@/lib/db/index';
import { createAuthenticatedHomeAt } from '@/lib/process/claude-print';
import { buildAssetCliArgs } from '@/lib/general/asset-cli';
import type { Asset } from '@/types';
import {
  briefingSessions,
  briefingMessages,
  campaigns,
  battlefields,
  assets,
} from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import { config } from '@/lib/config';
import { buildBriefingSystemPrompt, buildBriefingUserMessage } from './briefing-prompt';
import { GENERATE_PLAN_CONTRACT, GENERATE_PLAN_SYSTEM_PROMPT } from './briefing-contract';
import { formatAssetRoster } from './asset-roster';
import { insertPlanFromJSON } from '@/actions/campaign-helpers';
import type { PlanJSON } from '@/types';
import { detectCycle } from '@/lib/utils/dependency-graph';

// ---------------------------------------------------------------------------
// System asset lookup (inlined from deleted @/lib/orchestrator/system-asset)
// ---------------------------------------------------------------------------

const _systemAssetCache = new Map<string, { asset: Asset; cachedAt: number }>();
const SYSTEM_ASSET_CACHE_TTL = 60_000;

function getSystemAsset(codename: string): Asset {
  const now = Date.now();
  const cached = _systemAssetCache.get(codename);
  if (cached && (now - cached.cachedAt) < SYSTEM_ASSET_CACHE_TTL) {
    return cached.asset;
  }
  const db = getDatabase();
  const asset = db.select().from(assets).where(eq(assets.codename, codename)).get();
  if (!asset) throw new Error(`System asset ${codename} not found. Run seed.`);
  _systemAssetCache.set(codename, { asset, cachedAt: now });
  return asset;
}

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
/**
 * Rewrite the settings.json inside an isolated HOME to clear `enabledPlugins`.
 * Plugin-provided tools (e.g. typescript-lsp → `LSP`) are not suppressed by
 * `--tools ""`, so on a `--max-turns 1` run the model will happily reach for
 * them and the CLI will exit 1 when the turn budget runs out mid-tool-call.
 * Keeps the rest of settings (credentials, permissions mode) intact.
 */
function disableHomePlugins(homePath: string): void {
  const settingsPath = path.join(homePath, '.claude', 'settings.json');
  try {
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    parsed.enabledPlugins = {};
    fs.writeFileSync(settingsPath, JSON.stringify(parsed, null, 2));
  } catch {
    // Best-effort: if settings don't exist or can't be parsed, leave them.
  }
}

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

  // Build asset CLI args. We strip:
  //  - --max-turns: we set our own below.
  //  - --append-system-prompt: buildAssetCliArgs emits the stored seed prompt,
  //    but we always replace it at runtime with the composed system prompt
  //    (identity + contract + CLAUDE.md + SPEC.md + roster). Passing both
  //    would duplicate the identity section.
  const assetArgs = buildAssetCliArgs(strategistAsset);
  const filteredAssetArgs = filterFlags(assetArgs, [
    '--max-turns',
    '--append-system-prompt',
  ]);

  // 6. Detect GENERATE PLAN — uses a completely fresh process (no --resume)
  // so the model gets a single clean instruction with conversation history
  // replayed in stdin, rather than carrying accumulated multi-turn context
  // from the chat session.
  const isFirstMessage = !session.sessionId;
  const isGeneratePlan = message.trim().toUpperCase() === 'GENERATE PLAN';

  // Composed system prompt: stable across turns within a briefing and across
  // briefings on the same battlefield, so eligible for prompt caching.
  // GENERATE PLAN uses a dedicated tool-free system prompt — the conversation
  // BRIEFING_CONTRACT advertises Read/Glob/Grep, which makes the model
  // hallucinate tool-call markup when tools are stripped for plan emission.
  const composedSystemPrompt = isGeneratePlan
    ? GENERATE_PLAN_SYSTEM_PROMPT
    : buildBriefingSystemPrompt({
        claudeMdPath: battlefield.claudeMdPath,
        specMdPath: battlefield.specMdPath,
        allAssets,
      });

  // Conversation mode: read-only recon tools (Read, Glob, Grep) so STRATEGIST
  // can scout the codebase while planning. No Bash, Edit, Write, or web tools —
  // planning is pure analysis.
  // GENERATE PLAN mode: all tools disabled and max-turns 1 so the response
  // MUST be raw JSON — the model cannot announce "Let me read the files…"
  // and burn its single turn on a tool call instead of emitting the plan.
  const cliArgs: string[] = [
    '--print',
    '--verbose',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--dangerously-skip-permissions',
    '--tools', isGeneratePlan ? '' : 'Read,Glob,Grep',
    '--max-turns', isGeneratePlan ? '1' : '10',
    '--append-system-prompt', composedSystemPrompt,
    ...filteredAssetArgs,
  ];

  // Resume the existing session for normal conversation messages only.
  // GENERATE PLAN uses a fresh process (no --resume) so the model gets
  // a single clean instruction with conversation history replayed in
  // stdin, rather than carrying accumulated multi-turn context from the
  // chat session.
  if (!isFirstMessage && session.sessionId && !isGeneratePlan) {
    cliArgs.push('--resume', session.sessionId);
  }

  // 7. Build stdin content. The stable contract + CLAUDE.md + SPEC.md + roster
  // are already in --append-system-prompt, so stdin only carries volatile
  // per-turn content.
  let stdinContent: string;

  if (isGeneratePlan) {
    // GENERATE PLAN runs fresh (no --resume), so it needs enough context to
    // re-ground itself: the conversation history plus the strict format rules.
    const history = db
      .select({ role: briefingMessages.role, content: briefingMessages.content })
      .from(briefingMessages)
      .where(eq(briefingMessages.briefingId, session.id))
      .all();

    const conversationLines = history.map((m) =>
      m.role === 'commander'
        ? `Commander: ${m.content}`
        : `STRATEGIST: ${m.content.slice(0, 2000)}`,
    );

    stdinContent = `Campaign: "${campaign.name}" | Battlefield: ${battlefield.codename}

CAMPAIGN OBJECTIVE:
${campaign.objective}

AVAILABLE MISSION ASSETS:
${formatAssetRoster(allAssets)}

BRIEFING CONVERSATION SUMMARY:
${conversationLines.join('\n\n')}

---

${GENERATE_PLAN_CONTRACT}`;
  } else if (isFirstMessage) {
    stdinContent = buildBriefingUserMessage({
      campaignName: campaign.name,
      campaignObjective: campaign.objective,
      battlefieldCodename: battlefield.codename,
      commanderMessage: message,
    });
  } else {
    stdinContent = message;
  }

  // 8. Spawn Claude process with isolated HOME
  // Use a persistent HOME per campaign so --resume can find previous session data.
  // For GENERATE PLAN we don't --resume, so we also scrub any enabled plugins
  // from the copied settings.json — plugin-provided tools (e.g. typescript-lsp
  // exposes `LSP`) bypass `--tools ""`, and with `--max-turns 1` a tool call
  // exhausts the budget and the CLI exits 1.
  const persistentHome = createAuthenticatedHomeAt(`/tmp/claude-briefing-${campaignId}`);
  if (isGeneratePlan) {
    disableHomePlugins(persistentHome);
  }

  const abortController = new AbortController();
  const proc = spawn(config.claudePath, cliArgs, {
    cwd: battlefield.repoPath,
    signal: abortController.signal,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, HOME: persistentHome },
  });

  activeProcesses.set(campaignId, { proc, abort: abortController });

  if (isGeneratePlan) {
    console.log(
      `[BRIEFING] GENERATE PLAN triggered for campaign ${campaignId} ` +
      `(stdinBytes=${stdinContent.length}, systemPromptBytes=${composedSystemPrompt.length})`,
    );
  }

  const room = `briefing:${campaignId}`;
  let fullResponse = '';
  let extractedSessionId: string | null = null;
  let lineBuffer = '';
  let rawStdout = '';

  // Parse stream-json output line by line
  proc.stdout.on('data', (chunk: Buffer) => {
    const s = chunk.toString();
    if (rawStdout.length < 8000) rawStdout += s;
    lineBuffer += s;
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

        // Stream deltas from stream_event wrapper (real-time token streaming).
        // For GENERATE PLAN we still stream so the user gets visible progress
        // — the raw JSON (plus any preamble the forbidden-openings rules
        // didn't catch) will flash through the chat, but on completion we
        // replace it with the formatted plan summary.
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
      void (async () => {
        try {
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
            console.error(
              `[BRIEFING] STRATEGIST exited code=${code} campaign=${campaignId} ` +
              `isGeneratePlan=${isGeneratePlan} stdinBytes=${stdinContent.length} ` +
              `stdoutBytes=${fullResponse.length} stderr=${stderrOutput || '<empty>'}\n` +
              `[BRIEFING] rawStdout (first ${rawStdout.length} bytes):\n${rawStdout}`,
            );
            const errorMsg = `STRATEGIST process exited with code ${code}: ${stderrOutput.slice(0, 500)}`;
            io.to(room).emit('briefing:error', { campaignId, error: errorMsg });
            reject(new Error(errorMsg));
            return;
          }

          const responseText = fullResponse.trim();

          // For GENERATE PLAN: extract the plan first, then store a formatted
          // summary in the chat instead of the raw JSON blob. If extraction
          // fails, attempt one silent retry with a stricter re-prompt before
          // giving up with a distinct failure notification.
          let storedContent = responseText;
          if (isGeneratePlan) {
            let planText = responseText;
            let plan = tryExtractAndValidatePlan(planText);

            if (!plan) {
              console.warn(
                `[BRIEFING] Plan parse failed for campaign ${campaignId}; retrying once with stricter re-prompt`,
              );
              try {
                const retryStdin = `Your previous response was not valid JSON. Output ONLY the JSON object now — no prose, no code fences, no backticks, no preamble.\n\n${stdinContent}`;
                const retry = await spawnStrategistPlan({
                  battlefieldRepoPath: battlefield.repoPath,
                  persistentHome,
                  cliArgs,
                  stdinContent: retryStdin,
                });
                planText = retry.text;
                plan = tryExtractAndValidatePlan(planText);
              } catch (retryErr) {
                console.error(`[BRIEFING] Retry spawn failed:`, retryErr);
              }
            }

            if (plan) {
              const totalMissions = plan.phases.reduce((s, p) => s + p.missions.length, 0);
              console.log(
                `[BRIEFING] Plan generated for campaign ${campaignId}: ${plan.phases.length} phases, ${totalMissions} missions`,
              );
              insertPlanFromJSON(campaignId, campaign.battlefieldId, plan);

              db.update(campaigns)
                .set({ status: 'planning', updatedAt: Date.now() })
                .where(eq(campaigns.id, campaignId))
                .run();

              storedContent = formatPlanSummary(plan);

              io.to(room).emit('briefing:plan-ready', { campaignId, plan });
            } else {
              console.error(
                `[BRIEFING] Plan extraction failed after retry for campaign ${campaignId}`,
              );
              const parseFailureMessage =
                "STRATEGIST's plan could not be parsed as JSON after one retry. Ask the STRATEGIST to output the plan as a single JSON object with a \"summary\" key.";
              io.to(room).emit('briefing:plan-parse-failed', {
                campaignId,
                error: parseFailureMessage,
              });
              // Also emit the generic error event so the existing UI loading-state
              // handler unblocks. The distinct event above is for future UI specificity.
              io.to(room).emit('briefing:error', {
                campaignId,
                error: parseFailureMessage,
              });
              storedContent = parseFailureMessage;
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
        } catch (err) {
          activeProcesses.delete(campaignId);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      })();
    });

    proc.on('error', (err) => {
      console.error(
        `[BRIEFING] STRATEGIST spawn error campaign=${campaignId} ` +
        `isGeneratePlan=${isGeneratePlan}:`,
        err,
      );
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
// spawnStrategistPlan — one-shot silent spawn for GENERATE PLAN retries
// ---------------------------------------------------------------------------

/**
 * Spawn a one-shot STRATEGIST process for GENERATE PLAN. Returns the raw
 * response text. Used by the retry path when the primary GENERATE PLAN
 * attempt produced un-parseable output. Intentionally NOT plumbed into
 * active-process tracking or streaming emits — retries are brief and silent
 * (the user already saw the primary attempt stream).
 */
async function spawnStrategistPlan(params: {
  battlefieldRepoPath: string;
  persistentHome: string;
  cliArgs: string[];
  stdinContent: string;
}): Promise<{ text: string; code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(config.claudePath, params.cliArgs, {
      cwd: params.battlefieldRepoPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HOME: params.persistentHome },
    });

    let text = '';
    let stderr = '';
    let lineBuffer = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === 'stream_event' && event.event) {
            const inner = event.event;
            if (
              inner.type === 'content_block_delta' &&
              inner.delta?.type === 'text_delta' &&
              inner.delta.text
            ) {
              text += inner.delta.text;
            }
          }
          if (event.type === 'result') {
            if (!text && event.result && typeof event.result === 'string') {
              text = event.result;
            }
          }
        } catch { /* ignore non-JSON lines */ }
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.stdin.write(params.stdinContent);
    proc.stdin.end();

    proc.on('close', (code) => resolve({ text, code, stderr }));
    proc.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// tryExtractAndValidatePlan — combined parse + cycle-detection
// ---------------------------------------------------------------------------

/**
 * Combined extract + validate for a STRATEGIST plan response. Returns a
 * valid PlanJSON on success, or null on any failure (parse error, cycle
 * detected, insert-time validation error). Errors are logged so retries
 * and final failures are attributable.
 */
function tryExtractAndValidatePlan(text: string): PlanJSON | null {
  try {
    const plan = extractPlanJSON(text);
    if (!plan) return null;

    const allMissions = plan.phases.flatMap((p) =>
      p.missions.map((m) => ({ title: m.title, dependsOn: m.dependsOn ?? [] })),
    );
    const cycle = detectCycle(allMissions);
    if (cycle) {
      console.warn(`[BRIEFING] Plan contains circular dependencies: ${cycle}`);
      return null;
    }

    return plan;
  } catch (err) {
    console.warn(
      '[BRIEFING] Plan extraction/validation threw:',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
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
