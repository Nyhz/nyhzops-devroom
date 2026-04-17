import { getDatabase } from '@/lib/db';
import { comms } from '@/lib/db/schema';
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

/**
 * Convert a Claude Code stream-json event into a human-readable single-line
 * comm message. Returns null to skip events that carry no Commander-visible
 * information (system init, per-token deltas, the final result event — which
 * is already surfaced via the exit classifier).
 */
export function formatCommsEvent(ev: StreamJsonEvent): string | null {
  switch (ev.type) {
    case 'assistant': {
      const text = typeof ev.text === 'string' ? ev.text.trim() : '';
      if (!text) return null;
      const preview = text.length > 400 ? `${text.slice(0, 400)}…` : text;
      return preview;
    }
    case 'tool_use': {
      const name = typeof ev.name === 'string' ? ev.name : 'tool';
      const input = (ev as { input?: unknown }).input;
      const summary = summarizeToolInput(name, input);
      return summary ? `⚙ ${name}: ${summary}` : `⚙ ${name}`;
    }
    case 'tool_result': {
      const content = (ev as { content?: unknown }).content;
      const preview = summarizeToolResult(content);
      const isError = (ev as { is_error?: boolean }).is_error === true;
      const glyph = isError ? '✗' : '✓';
      return preview ? `${glyph} result: ${preview}` : `${glyph} result`;
    }
    case 'system':
    case 'user':
    case 'stream_event':
    case 'result':
      return null;
    default:
      return null;
  }
}

function summarizeToolInput(_name: string, input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const rec = input as Record<string, unknown>;
  const candidates = ['command', 'file_path', 'path', 'pattern', 'query', 'url'];
  for (const key of candidates) {
    const v = rec[key];
    if (typeof v === 'string' && v.length > 0) {
      return v.length > 200 ? `${v.slice(0, 200)}…` : v;
    }
  }
  const desc = rec.description;
  if (typeof desc === 'string' && desc.length > 0) {
    return desc.length > 200 ? `${desc.slice(0, 200)}…` : desc;
  }
  // Fall back to a compact JSON preview for unknown tool shapes.
  try {
    const s = JSON.stringify(rec);
    return s.length > 200 ? `${s.slice(0, 200)}…` : s;
  } catch {
    return null;
  }
}

function summarizeToolResult(content: unknown): string | null {
  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (!trimmed) return null;
    return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
  }
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part === 'object') {
        const text = (part as { text?: unknown }).text;
        if (typeof text === 'string' && text.trim().length > 0) {
          const t = text.trim();
          return t.length > 200 ? `${t.slice(0, 200)}…` : t;
        }
      }
    }
  }
  return null;
}

type Emitter = (room: string, event: string, payload: unknown) => void;
let explicitEmitter: Emitter | null = null;

export function setCommsEmitter(fn: Emitter | null): void {
  explicitEmitter = fn;
}

/**
 * Resolve the socket emitter. Prefer the explicit override (used by tests),
 * otherwise fall back to `globalThis.io` — which the custom server assigns
 * at boot. Previously this module used a private `emitter` variable that
 * `setCommsEmitter` was supposed to populate at boot, but no caller ever
 * invoked it, so every socket emission from CONTROL was silently dropped.
 */
function resolveEmitter(): Emitter | null {
  if (explicitEmitter) return explicitEmitter;
  const io = (globalThis as { io?: { to: (room: string) => { emit: (event: string, payload: unknown) => void } } }).io;
  if (!io) return null;
  return (room, event, payload) => io.to(room).emit(event, payload);
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
