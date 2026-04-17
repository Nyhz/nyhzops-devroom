import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db';
import { battlefields, comms, missions } from '@/lib/db/schema';
import { ulid } from 'ulid';
import type { StreamJsonEvent } from './spawn-asset';

export interface CommEvent {
  missionId?: string;
  campaignId?: string;
  battlefieldId?: string;
  actor?: string; // defaults to 'CONTROL'
  message: string;
  level?: 'info' | 'warn' | 'error';
}

export interface FormatCommsOpts {
  /**
   * Worktree path used by mission-runner as the debrief drop target. When
   * provided, a `Write` tool_use targeting this path collapses to a generic
   * `⚙ Write debrief.json` line — the raw JSON body is never echoed.
   */
  debriefDropPath?: string;
}

/**
 * Convert a Claude Code stream-json event into zero or more human-readable
 * single-line comm messages. Real Claude output nests text, tool_use, and
 * tool_result parts inside `event.message.content[]`; a single event can
 * produce multiple comm lines (e.g. a text thought followed by a tool_use).
 *
 * Legacy flat shape (`{type:'assistant', text:'...'}`) is supported as a
 * fallback so scripted-claude test fixtures keep working.
 */
export function formatCommsEvent(
  ev: StreamJsonEvent,
  opts: FormatCommsOpts = {},
): string[] {
  const out: string[] = [];

  // Nested real-Claude shape: walk message.content[]
  const msg = (ev as { message?: unknown }).message;
  if (msg && typeof msg === 'object') {
    const content = (msg as { content?: unknown }).content;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (!part || typeof part !== 'object') continue;
        const p = part as Record<string, unknown>;
        const ptype = p.type;
        if (ptype === 'text' && typeof p.text === 'string') {
          const visible = stripDebriefBlock(p.text).trim();
          if (visible) out.push(visible.length > 400 ? `${visible.slice(0, 400)}…` : visible);
        } else if (ptype === 'tool_use') {
          const name = typeof p.name === 'string' ? p.name : 'tool';
          out.push(formatToolUse(name, p.input, opts));
        }
        // tool_result intentionally dropped — the asset's narration conveys intent;
        // raw tool output is noise in the comms stream.
      }
      return out;
    }
  }

  // Legacy flat shape fallback (scripted-claude fixtures, older events)
  switch (ev.type) {
    case 'assistant': {
      const raw = typeof ev.text === 'string' ? ev.text : '';
      const text = stripDebriefBlock(raw).trim();
      if (!text) return [];
      return [text.length > 400 ? `${text.slice(0, 400)}…` : text];
    }
    case 'tool_use': {
      const name = typeof ev.name === 'string' ? ev.name : 'tool';
      return [formatToolUse(name, (ev as { input?: unknown }).input, opts)];
    }
    case 'tool_result':
      return [];
    default:
      return [];
  }
}

/**
 * Render a tool_use line for the comms terminal. Default is `⚙ Name`; for
 * file-oriented tools we append a short `parent/file` hint, and for Edit we
 * include `(+added -removed)` line counts. The Terminal component paints the
 * `(+N -M)` suffix green/red.
 */
function formatToolUse(
  name: string,
  input: unknown,
  opts: FormatCommsOpts = {},
): string {
  const rec = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};

  // Debrief drop: the asset's Write to the debrief path carries the full
  // JSON body in `input.content`. Don't let that payload balloon the comms
  // stream — show a compact "debrief submitted" marker instead.
  if (name === 'Write' && opts.debriefDropPath) {
    const fp = typeof rec.file_path === 'string' ? rec.file_path : '';
    if (fp === opts.debriefDropPath || fp.endsWith(opts.debriefDropPath)) {
      return `⚙ Write debrief.json`;
    }
  }

  // Name-specific rendering runs first — for Grep/Glob the interesting bit is
  // the pattern, not the optional `path` argument, so we must not fall through
  // to the generic file_path branch.
  if (name === 'Edit' || name === 'NotebookEdit') {
    const oldS = typeof rec.old_string === 'string' ? rec.old_string
      : typeof rec.old_source === 'string' ? rec.old_source
      : '';
    const newS = typeof rec.new_string === 'string' ? rec.new_string
      : typeof rec.new_source === 'string' ? rec.new_source
      : '';
    const removed = oldS ? oldS.split('\n').length : 0;
    const added = newS ? newS.split('\n').length : 0;
    const fp = pickFilePath(rec);
    const loc = fp ? ` ${shortPath(fp)}` : '';
    return `⚙ ${name}${loc} (+${added} -${removed})`;
  }

  if (name === 'Grep' || name === 'Glob') {
    const pat = typeof rec.pattern === 'string' ? rec.pattern : null;
    return pat ? `⚙ ${name} ${truncate(pat, 60)}` : `⚙ ${name}`;
  }

  if (name === 'Bash') {
    const desc = typeof rec.description === 'string' ? rec.description : null;
    if (desc) return `⚙ ${name} ${truncate(desc, 60)}`;
    const cmd = typeof rec.command === 'string' ? rec.command.trim() : '';
    return cmd ? `⚙ ${name} ${truncate(cmd, 60)}` : `⚙ ${name}`;
  }

  const filePath = pickFilePath(rec);
  if (filePath) {
    return `⚙ ${name} ${shortPath(filePath)}`;
  }

  return `⚙ ${name}`;
}

function pickFilePath(rec: Record<string, unknown>): string | null {
  if (typeof rec.file_path === 'string') return rec.file_path;
  if (typeof rec.path === 'string') return rec.path;
  if (typeof rec.notebook_path === 'string') return rec.notebook_path;
  return null;
}

/** parent-dir/filename — strips the rest of the absolute path. */
function shortPath(p: string): string {
  const parts = p.split('/').filter(Boolean);
  if (parts.length <= 1) return p;
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Remove the `<DEBRIEF>…</DEBRIEF>` block (closed or open-ended) from an
 * asset's text output. The debrief is consumed by the parser and rendered
 * in the Debrief panel — having it also echo into COMMS just doubles noise
 * at mission completion.
 */
function stripDebriefBlock(text: string): string {
  const openIdx = text.indexOf('<DEBRIEF>');
  if (openIdx === -1) return text;
  const closeIdx = text.indexOf('</DEBRIEF>', openIdx);
  const tail = closeIdx === -1 ? '' : text.slice(closeIdx + '</DEBRIEF>'.length);
  return (text.slice(0, openIdx) + tail).replace(/\n{3,}/g, '\n\n');
}

type Emitter = (room: string, event: string, payload: unknown) => void;
let explicitEmitter: Emitter | null = null;
let warnedNoEmitter = false;

export function setCommsEmitter(fn: Emitter | null): void {
  explicitEmitter = fn;
}

/**
 * Test-only helper: reset the one-time "no emitter wired" warning latch so
 * individual tests can assert the warn-once behavior cleanly. Not exported
 * for production use — the name carries the intent.
 */
export function __resetCommsEmitterWarningForTests(): void {
  warnedNoEmitter = false;
}

/**
 * Resolve the socket emitter previously registered via `setCommsEmitter`.
 *
 * Contract:
 *   - `server.ts` MUST call `setCommsEmitter(...)` during boot, right after
 *     the Socket.IO server is constructed. The production wiring is a thin
 *     closure over `io.to(room).emit(event, payload)`.
 *   - If no emitter is wired, returns `null`. Callers are expected to no-op
 *     on null (DB writes via `emitComm` must still succeed — CONTROL must
 *     not crash on boot-order bugs).
 *   - The first unwired lookup logs a one-time `console.warn` so silent
 *     drops become visible in dev/test without spamming the log.
 *
 * No implicit `globalThis.io` fallback — that path made boot-ordering bugs
 * invisible. If you land here puzzled about missing socket traffic, the
 * fix is to ensure `setCommsEmitter` was called at boot.
 */
function resolveEmitter(): Emitter | null {
  if (explicitEmitter) return explicitEmitter;
  if (!warnedNoEmitter) {
    warnedNoEmitter = true;
    console.warn('[CONTROL] setCommsEmitter not wired — socket emissions dropped until boot completes');
  }
  return null;
}

export function emitComm(ev: CommEvent): void {
  const db = getDatabase();
  const row = {
    id: ulid(),
    missionId: ev.missionId ?? null,
    campaignId: ev.campaignId ?? null,
    battlefieldId: ev.battlefieldId ?? null,
    actor: ev.actor ?? 'CONTROL',
    message: ev.message,
    level: ev.level ?? 'info',
    createdAt: Date.now(),
  };
  db.insert(comms).values(row).run();

  const emitter = resolveEmitter();
  if (emitter && ev.missionId) {
    emitter(`mission:${ev.missionId}`, 'mission:log', row);
  }
  if (emitter && ev.campaignId) {
    emitter(`campaign:${ev.campaignId}`, 'campaign:log', row);
  }

  if (emitter && ev.missionId && row.actor === 'CONTROL') {
    const activity = buildActivityPayload(ev.missionId, row.message, row.createdAt);
    if (activity) emitter('hq:activity', 'activity:event', activity);
  }
}

/** Match CONTROL comms that represent mission activity beats. */
const ACTIVITY_PATTERNS: Array<{ pattern: RegExp; type: (m: RegExpMatchArray) => string }> = [
  { pattern: /^Status\s*(?:→|->)\s*([A-Z_ ]+)\s*$/i, type: (m) => `mission:${m[1].trim().toLowerCase().replace(/\s+/g, '_')}` },
  { pattern: /^Mission\s+(queued|accomplished|compromised|abandoned)\b/i, type: (m) => `mission:${m[1].toLowerCase()}` },
];

interface ActivityPayload {
  type: string;
  battlefieldCodename: string;
  missionTitle: string;
  timestamp: number;
  detail: string;
}

function buildActivityPayload(
  missionId: string,
  message: string,
  timestamp: number,
): ActivityPayload | null {
  let type: string | null = null;
  for (const { pattern, type: mkType } of ACTIVITY_PATTERNS) {
    const m = message.trim().match(pattern);
    if (m) { type = mkType(m); break; }
  }
  if (!type) return null;

  try {
    const db = getDatabase();
    const row = db
      .select({
        title: missions.title,
        bfCodename: battlefields.codename,
      })
      .from(missions)
      .leftJoin(battlefields, eq(battlefields.id, missions.battlefieldId))
      .where(eq(missions.id, missionId))
      .get();
    if (!row) return null;
    return {
      type,
      battlefieldCodename: row.bfCodename ?? 'UNKNOWN',
      missionTitle: row.title ?? 'Untitled',
      timestamp,
      detail: message,
    };
  } catch {
    return null;
  }
}

/**
 * Broadcast a mission status change so subscribed UIs update live without
 * a route refresh. Fires:
 *   - `mission:status` on the mission's own room (LiveStatusBadge, mission detail).
 *   - `mission:status` on the parent campaign room (campaign view mission list).
 *   - `campaign:mission-status` on the campaign room (legacy listener shape).
 *
 * Status-only — does not persist anything. Callers still update the DB.
 */
export function emitMissionStatus(
  missionId: string,
  status: string,
  opts: { campaignId?: string | null; compromiseReason?: string | null } = {},
): void {
  const emitter = resolveEmitter();
  if (!emitter) return;
  const missionPayload = {
    missionId,
    status,
    ...(opts.compromiseReason ? { compromiseReason: opts.compromiseReason } : {}),
  };
  emitter(`mission:${missionId}`, 'mission:status', missionPayload);
  if (opts.campaignId) {
    emitter(`campaign:${opts.campaignId}`, 'mission:status', missionPayload);
    emitter(`campaign:${opts.campaignId}`, 'campaign:mission-status', {
      campaignId: opts.campaignId,
      missionId,
      status,
    });
  }
}
