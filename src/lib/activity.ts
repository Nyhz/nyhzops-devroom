import { and, desc, eq, like, or, sql } from 'drizzle-orm';
import { getDatabase } from '@/lib/db';
import { battlefields, comms, missions } from '@/lib/db/schema';

export interface ActivityEvent {
  type: string;
  battlefieldCodename: string;
  missionTitle: string;
  timestamp: number;
  detail: string;
}

/**
 * Derive recent activity events from the comms table. Matches CONTROL status
 * beats: "Status → X" and "Mission queued|accomplished|compromised|abandoned".
 * Joined to mission + battlefield so the feed has codenames and titles.
 */
export function loadInitialActivity(limit = 10): ActivityEvent[] {
  const db = getDatabase();
  const rows = db
    .select({
      message: comms.message,
      createdAt: comms.createdAt,
      missionTitle: missions.title,
      bfCodename: battlefields.codename,
    })
    .from(comms)
    .leftJoin(missions, eq(missions.id, comms.missionId))
    .leftJoin(battlefields, eq(battlefields.id, missions.battlefieldId))
    .where(
      and(
        eq(comms.actor, 'CONTROL'),
        sql`${comms.missionId} IS NOT NULL`,
        or(
          like(comms.message, 'Status \u2192 %'),
          like(comms.message, 'Mission queued%'),
          like(comms.message, 'Mission accomplished%'),
          like(comms.message, 'Mission compromised%'),
          like(comms.message, 'Mission abandoned%'),
        ),
      ),
    )
    .orderBy(desc(comms.createdAt))
    .limit(limit)
    .all();

  return rows.map((r) => ({
    type: deriveType(r.message),
    battlefieldCodename: r.bfCodename ?? 'UNKNOWN',
    missionTitle: r.missionTitle ?? 'Untitled',
    timestamp: r.createdAt,
    detail: r.message,
  }));
}

function deriveType(message: string): string {
  const m = message.trim().match(/^Status\s*(?:\u2192|->)\s*([A-Z_ ]+)\s*$/i);
  if (m) return `mission:${m[1].trim().toLowerCase().replace(/\s+/g, '_')}`;
  const q = message.trim().match(/^Mission\s+(queued|accomplished|compromised|abandoned)\b/i);
  if (q) return `mission:${q[1].toLowerCase()}`;
  return 'mission:event';
}
