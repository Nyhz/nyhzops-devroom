'use server';

import { eq, desc, and } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { overseerLogs } from '@/lib/db/schema';
import type { OverseerLog } from '@/types';

// ---------------------------------------------------------------------------
// Types (previously in @/lib/overseer/overseer-db — inlined after deletion)
// ---------------------------------------------------------------------------

export interface OverseerLogFilters {
  missionId?: string;
  battlefieldId?: string;
  campaignId?: string;
  escalatedOnly?: boolean;
}

export interface OverseerStats {
  totalDecisions: number;
  escalationCount: number;
  escalationRate: number;
  confidenceDistribution: {
    high: number;
    medium: number;
    low: number;
  };
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

export async function getOverseerLogs(filters?: OverseerLogFilters): Promise<OverseerLog[]> {
  const db = getDatabase();
  const conditions = [];

  if (filters?.missionId) {
    conditions.push(eq(overseerLogs.missionId, filters.missionId));
  }
  if (filters?.battlefieldId) {
    conditions.push(eq(overseerLogs.battlefieldId, filters.battlefieldId));
  }
  if (filters?.campaignId) {
    conditions.push(eq(overseerLogs.campaignId, filters.campaignId));
  }
  if (filters?.escalatedOnly) {
    conditions.push(eq(overseerLogs.escalated, 1));
  }

  const query = db
    .select()
    .from(overseerLogs)
    .orderBy(desc(overseerLogs.timestamp));

  if (conditions.length > 0) {
    return query.where(and(...conditions)).all() as OverseerLog[];
  }

  return query.all() as OverseerLog[];
}

export async function getOverseerStats(): Promise<OverseerStats> {
  const db = getDatabase();
  const allLogs = db.select().from(overseerLogs).all() as OverseerLog[];

  const total = allLogs.length;
  const escalations = allLogs.filter((l) => l.escalated === 1).length;
  const high = allLogs.filter((l) => l.confidence === 'high').length;
  const medium = allLogs.filter((l) => l.confidence === 'medium').length;
  const low = allLogs.filter((l) => l.confidence === 'low').length;

  return {
    totalDecisions: total,
    escalationCount: escalations,
    escalationRate: total > 0 ? escalations / total : 0,
    confidenceDistribution: { high, medium, low },
  };
}
